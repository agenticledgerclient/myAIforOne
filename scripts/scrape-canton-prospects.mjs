#!/usr/bin/env node
/**
 * Scrape Featured App Requests from lists.sync.global/g/tokenomics
 * Extracts SDR prospect data: company, app, emails, URLs, summaries
 */

import { chromium } from 'playwright';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const BASE_URL = 'https://lists.sync.global/g/tokenomics/topics';
const OUTPUT_FILE = '/Users/oreph/Desktop/APPs/channelToAgentToClaude/canton-prospects.json';
const PROGRESS_FILE = '/Users/oreph/Desktop/APPs/channelToAgentToClaude/canton-scrape-progress.json';
const MAX_PAGES = 38; // 760 topics / 20 per page

function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { lastPage: 0, prospects: [], skippedTopics: [], nextPageUrl: null };
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function saveResults(prospects) {
  writeFileSync(OUTPUT_FILE, JSON.stringify(prospects, null, 2));
}

// Extract a field value from the page text given a label
function extractField(text, label) {
  const labelPatterns = [
    'Disclaimer',
    'BRAND GUIDLINES',
    'Email',
    'Name of applying institution',
    'Summary of Company and Background',
    'Name of the application',
    'URL of the applying institution',
    'Product Website',
    'Emails for Responsible Persons',
    'Provide a summary of what your application will do',
    'Describe the expected users',
    'How will your application interact',
    'Describe how your application will interact with the ledger',
    'Describe the activities',
    'Does this activity use',
    'On a per user basis',
    'Under what conditions',
    'How do you expect your transactions to scale',
    'What is your anticipated launch date',
    'Who will be your first customers',
    'How would not having FA status',
    'Does your application have any controls',
    'Additional Notes',
    'Note:',
    'Party ID for the Featured Application',
  ];

  const idx = text.indexOf(label);
  if (idx === -1) return '';

  const afterLabel = text.substring(idx + label.length).replace(/^[:\s]*/, '');

  // Find the next label
  let endIdx = afterLabel.length;
  for (const nextLabel of labelPatterns) {
    if (nextLabel === label) continue;
    const nextIdx = afterLabel.indexOf(nextLabel);
    if (nextIdx > 0 && nextIdx < endIdx) {
      endIdx = nextIdx;
    }
  }

  return afterLabel.substring(0, endIdx).trim();
}

async function scrapeTopic(page, url, title) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the first expanded message content
    const content = await page.evaluate(() => {
      const msg = document.querySelector('.expanded-message');
      if (msg) return msg.innerText;
      const main = document.querySelector('#main-content');
      return main ? main.innerText : document.body.innerText;
    });

    if (!content || content.length < 100) {
      console.log(`  [WARN] Short content for: ${title}`);
      return null;
    }

    const prospect = {
      title: title,
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
      company: extractField(content, 'Name of applying institution'),
      appName: extractField(content, 'Name of the application'),
      companySummary: extractField(content, 'Summary of Company and Background'),
      companyUrl: extractField(content, 'URL of the applying institution'),
      productUrl: extractField(content, 'Product Website'),
      contactEmails: extractField(content, 'Emails for Responsible Persons'),
      submitterEmail: extractField(content, 'Email'),
      appSummary: extractField(content, 'Provide a summary of what your application will do'),
      expectedUsers: extractField(content, 'Describe the expected users'),
      partyId: extractField(content, 'Party ID for the Featured Application'),
      launchDate: extractField(content, 'What is your anticipated launch date'),
      firstCustomers: extractField(content, 'Who will be your first customers'),
    };

    if (!prospect.company && !prospect.appName) {
      console.log(`  [WARN] No company/app found for: ${title}`);
      return null;
    }

    console.log(`  [OK] ${prospect.company || prospect.appName}`);
    return prospect;

  } catch (err) {
    console.log(`  [ERR] ${title}: ${err.message}`);
    return null;
  }
}

async function getTopicLinksAndNextPage(page) {
  return await page.evaluate(() => {
    const links = [];
    // Topic links use /g/tokenomics/topic/ pattern
    const anchors = document.querySelectorAll('a[href*="/g/tokenomics/topic/"]');
    for (const a of anchors) {
      const text = a.textContent.trim();
      const href = a.href;
      if (text && href && !text.includes('Topics') && text.length > 5) {
        links.push({ title: text, url: href });
      }
    }

    // Find next page link
    let nextPageUrl = null;
    const nextLinks = document.querySelectorAll('a');
    for (const a of nextLinks) {
      if (a.textContent.trim() === 'next page' || a.getAttribute('aria-label') === 'Next') {
        nextPageUrl = a.href;
        break;
      }
    }
    // Also check for the > button
    if (!nextPageUrl) {
      const pageLinks = document.querySelectorAll('a[href*="page="]');
      for (const a of pageLinks) {
        if (a.textContent.trim() === '›' || a.textContent.trim() === '>') {
          nextPageUrl = a.href;
          break;
        }
      }
    }

    return { links, nextPageUrl };
  });
}

async function main() {
  console.log('=== Canton Featured App Prospect Scraper ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const progress = loadProgress();
  console.log(`Resuming from page ${progress.lastPage + 1}, ${progress.prospects.length} prospects so far`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    let currentUrl = progress.nextPageUrl || BASE_URL;

    for (let pageNum = progress.lastPage; pageNum < MAX_PAGES; pageNum++) {
      console.log(`\n--- Page ${pageNum + 1}/${MAX_PAGES} ---`);
      console.log(`URL: ${currentUrl}`);

      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      // Dismiss cookie banner if present
      try {
        const cookieBtn = page.locator('button:has-text("I Agree")');
        if (await cookieBtn.isVisible({ timeout: 1000 })) {
          await cookieBtn.click();
          await page.waitForTimeout(500);
        }
      } catch (e) { /* no cookie banner */ }

      const { links: topicLinks, nextPageUrl } = await getTopicLinksAndNextPage(page);
      console.log(`Found ${topicLinks.length} topic links`);

      // Deduplicate links (same URL can appear twice)
      const seen = new Set();
      const uniqueLinks = topicLinks.filter(l => {
        if (seen.has(l.url)) return false;
        seen.add(l.url);
        return true;
      });

      const faLinks = uniqueLinks.filter(l =>
        l.title.toLowerCase().includes('featured app request')
      );

      const nonFaLinks = uniqueLinks.filter(l =>
        !l.title.toLowerCase().includes('featured app request')
      );
      for (const nf of nonFaLinks) {
        if (!progress.skippedTopics.find(s => s.url === nf.url)) {
          progress.skippedTopics.push({ title: nf.title, url: nf.url });
        }
      }

      console.log(`Featured App Requests: ${faLinks.length}, Other: ${nonFaLinks.length}`);

      for (const link of faLinks) {
        if (progress.prospects.find(p => p.sourceUrl === link.url)) {
          console.log(`  [SKIP] Already scraped: ${link.title}`);
          continue;
        }

        console.log(`  Scraping: ${link.title}`);
        const prospect = await scrapeTopic(page, link.url, link.title);
        if (prospect) {
          progress.prospects.push(prospect);
        }

        // Be polite
        await page.waitForTimeout(1000 + Math.random() * 1500);
      }

      // Save progress after each page
      progress.lastPage = pageNum + 1;
      progress.nextPageUrl = nextPageUrl;
      saveProgress(progress);
      saveResults(progress.prospects);
      console.log(`Progress saved: ${progress.prospects.length} prospects after page ${pageNum + 1}`);

      if (!nextPageUrl) {
        console.log('No next page found — reached the end.');
        break;
      }
      currentUrl = nextPageUrl;

      // Delay between pages
      await page.waitForTimeout(1500 + Math.random() * 1000);
    }

  } catch (err) {
    console.error(`\nFATAL ERROR: ${err.message}`);
    saveProgress(progress);
    saveResults(progress.prospects);
    console.log(`Emergency save: ${progress.prospects.length} prospects`);
  } finally {
    await browser.close();
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total prospects: ${progress.prospects.length}`);
  console.log(`Skipped topics: ${progress.skippedTopics.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().catch(console.error);
