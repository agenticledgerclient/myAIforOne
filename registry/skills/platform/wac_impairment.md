---
name: wac_impairment
description: Process crypto transactions CSV to compute WAC (Weighted Average Cost) impairment adjustments. Calculates D-tracking, year-end recapture, impairment expense, and correct realized G/L. Use when applying annual impairment to existing WAC-based crypto accounting without recalculating historical disposals. Input is a CSV of transactions.
---

# WAC Impairment Calculator

Processes a Tres/DA journal-entry CSV (or simple CSV) of crypto transactions and applies the WAC impairment D-tracking method. Produces a 4-tab XLSX with row-by-row D-tracking, year-end summaries, full transaction detail, and formula reference.

## Supported Input Formats

### Format 1: Tres/DA Journal-Entry Export (auto-detected)

The file exported from Tres/DA with journal-entry rows. Auto-detected by presence of "Transaction Activity" column.

**Expected file structure:**
- Rows 1-5: Header section with wallet address (long alphanumeric string)
- Year-end snapshot rows: "31 December YYYY" followed by headers + data row with Asset Symbol, Purchase Cost, WAC, Qty, FV
- Transaction header row (contains "Timestamp")
- Transaction data rows with 36+ columns including:
  - Timestamp, Direction (inflow/outflow), Original Amount, Transfer Unit Fiat Price
  - Transaction Activity, Line Amount Type (Cost/Fair Value/Gain/Loss)
  - Chart of Account Name (Column AK — lowercase wallet address, used as the primary filter)

**Filtering logic:**
1. Column AK (Chart of Account Name) must match the file's wallet address (lowercase) — this is the population filter
2. Cost rows are primary (one per movement with cost basis)
3. Fair Value rows are included ONLY for transaction hashes that have no Cost row (captures staking rewards, revenue, etc.)
4. Gain/Loss rows are always skipped
5. Direction determines buy (inflow) vs sell (outflow)

### Format 2: Simple CSV

| Column | Description | Example |
|--------|-------------|---------|
| date | Transaction date | 2022-01-15 |
| type | "buy" or "sell" | buy |
| asset | Asset symbol | ETH |
| quantity | Units transacted | 20 |
| price_per_unit | Price per unit | 1200 |

## Workflow

### Step 1: Collect Inputs

Ask the user for:
1. **Transactions CSV path** — the file from Tres/DA or a simple CSV
2. **Fair values** — usually embedded in the file header snapshots, or provide inline: "SOL:2022=10,2023=102,2024=190"
3. **Output path** — default: `~/Desktop/{ASSET}_Impairment_Analysis.xlsx`

### Step 2: Run the Script

```bash
node ~/.claude/commands/scripts/wac_impairment_calc.mjs \
  --transactions /path/to/file.csv \
  --fv "SOL:2022=10,2023=102,2024=190" \
  --output ~/Desktop/SOL_Impairment_Analysis.xlsx
```

The script will automatically:
1. Detect the file format (journal-entry vs simple)
2. Extract the wallet address from the header
3. Filter transactions using Column AK (Chart of Account Name = lowercase wallet address)
4. Extract year-end snapshots from the header for opening balances and FV
5. **Reconcile quantities**: verify that opening qty + net transactions = ending qty from snapshot
6. If reconciliation passes, proceed; if not, warn and show the gap
7. Run the D-tracking WAC impairment engine
8. Generate the 4-tab XLSX

**With inline fair values (override or supplement file snapshots):**
```bash
node ~/.claude/commands/scripts/wac_impairment_calc.mjs \
  --transactions /path/to/file.csv \
  --fv "SOL:2022=10,2023=102,2024=190" \
  --output /path/to/output.xlsx
```

**With manual opening balance (if no snapshot in file):**
```bash
node ~/.claude/commands/scripts/wac_impairment_calc.mjs \
  --transactions /path/to/file.csv \
  --fv "ETH:2022=1100,2023=2200,2024=2400" \
  --opening "ETH:qty=100,wac=1200" \
  --output /path/to/output.xlsx
```

### Step 3: Review Output

The script produces a 4-tab XLSX:

**Tab 1: "D-Tracking"** — The main deliverable. Every transaction row with:
- #, Date, Type, Activity, Qty, Price/Unit
- Q Before, Q After, H Total (After), WAC Avg (After)
- D Before, D Formula (showing the actual calculation), D After, D Change
- Carrying Avg, Realized G/L, Cumulative G/L (YTD)
- Year-end separator rows showing: FV test, impairment calc, D adjustment, recapture, correct G/L

**Tab 2: "Year-End Summary"** — One row per asset per year:
- Year, Asset, Qty Held, Historical WAC Avg, Carrying Avg (Before/After)
- Fair Value, Historical G/L, Recapture, Correct G/L
- Impairment Expense, Net P&L Impact, D (Start/End/After)

**Tab 3: "Transactions"** — Flat transaction detail for reference

**Tab 4: "Formulas"** — Key formulas and filtering notes

### Step 4: Present Results

Show the user the year-end summary table and highlight:
- Total impairment expense per year
- Total recapture per year
- Correct realized G/L per year (= historical G/L + recapture)
- The reconciliation result (did quantities balance?)

## Script Location

```
~/.claude/commands/scripts/wac_impairment_calc.mjs
```

Requires the `xlsx` npm package. If not found, install:
```bash
cd /tmp && mkdir -p xlsx-pkg && cd xlsx-pkg && npm init -y && npm install xlsx
```

## Key Formulas Reference

| Formula | Expression |
|---------|-----------|
| WAC Average (on buy) | (old_total + buy_qty × price) / (old_qty + buy_qty) |
| Realized G/L (on sell) | sell_qty × (sell_price − WAC_avg) |
| D Update (sell) | D × (Q − sell_qty) / Q |
| D Update (buy) | unchanged |
| Carrying Average | (Historical_total − D) / Q |
| Impairment Expense | max(0, carrying_avg − FV) × Q_held |
| D after impairment | D + impairment_expense |
| Recapture | D_start_of_year − D_end_of_year (before new impairment) |
| Correct Realized G/L | Historical G/L + Recapture |

## Important Notes

- Run independently per asset (each asset has its own pool and D)
- No reversal under old impairment model — D only increases from impairment, decreases from sales
- Column AK (Chart of Account Name) is the definitive filter for Tres/DA exports — NOT Belongs To Address
- Staking rewards/revenue may only have Fair Value rows (no Cost row) — the script handles this automatically
- The quantity reconciliation step catches missing data before calculations run
