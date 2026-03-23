/**
 * Direct iMessage database reader.
 * Reads from ~/Library/Messages/chat.db to get message text from attributedBody
 * when the text column is empty (macOS 15+ behavior).
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), "Library", "Messages", "chat.db");

interface DBMessage {
  rowid: number;
  text: string;
  chatId: number;
  isFromMe: boolean;
  sender: string;
  createdAt: string;
  guid: string;
}

/**
 * Extract plain text from NSAttributedString binary blob (NSArchiver/typedstream format).
 * The text is stored after a \x01\x2B marker followed by a length byte, then raw UTF-8 bytes.
 */
function extractTextFromAttributedBody(hexData: string): string {
  try {
    const buf = Buffer.from(hexData, "hex");

    // Search for the \x01\x2B (NSArchiver string marker "+") pattern
    for (let i = 0; i < buf.length - 2; i++) {
      if (buf[i] === 0x01 && buf[i + 1] === 0x2b) {
        const len = buf[i + 2];
        if (len > 0 && i + 3 + len <= buf.length) {
          const text = buf.toString("utf-8", i + 3, i + 3 + len);
          // Sanity check: should contain at least some printable chars
          if (/[\x20-\x7E]/.test(text)) {
            return text.trim();
          }
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Get recent messages from a specific chat, with attributedBody fallback.
 */
export function getRecentMessages(chatId: number, sinceRowId: number, limit: number = 20): DBMessage[] {
  try {
    const query = `
      SELECT m.ROWID, m.text, m.is_from_me, m.handle_id,
             datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as created_at,
             m.guid, hex(m.attributedBody) as attr_hex,
             h.id as sender_id
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE cmj.chat_id = ${chatId}
        AND m.ROWID > ${sinceRowId}
        AND m.associated_message_type = 0
      ORDER BY m.date ASC
      LIMIT ${limit};
    `;

    const result = execSync(`sqlite3 -json "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, {
      timeout: 5000,
      encoding: "utf-8",
    });

    const rows = JSON.parse(result || "[]");
    return rows.map((row: any) => {
      let text = row.text || "";
      if (!text && row.attr_hex) {
        text = extractTextFromAttributedBody(row.attr_hex);
      }
      return {
        rowid: row.ROWID,
        text,
        chatId,
        isFromMe: row.is_from_me === 1,
        sender: row.sender_id || (row.is_from_me === 1 ? "me" : "unknown"),
        createdAt: row.created_at,
        guid: row.guid,
      };
    }).filter((m: DBMessage) => m.text.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Get the latest ROWID for a chat (for polling).
 */
export function getLatestRowId(chatId: number): number {
  try {
    const result = execSync(
      `sqlite3 "${DB_PATH}" "SELECT MAX(m.ROWID) FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id = ${chatId};"`,
      { timeout: 5000, encoding: "utf-8" }
    );
    return parseInt(result.trim()) || 0;
  } catch {
    return 0;
  }
}
