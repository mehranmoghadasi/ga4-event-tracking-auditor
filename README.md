# GA4 Event Tracking Auditor

> Validate your GA4 implementation against your tracking plan. Catch broken events before they corrupt your data.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

## The Problem

GA4 event tracking breaks silently. A developer deploys a change, a GTM container gets updated, or a new CMS version drops â and suddenly your `purchase` events are missing `currency`, your `generate_lead` events have the wrong `form_id`, or an entire custom event just stops firing. You only find out weeks later when stakeholders ask why conversions dropped.

Most teams don't have a systematic way to validate their GA4 implementation against their tracking spec.

## The Solution

`ga4-event-tracking-auditor` takes two inputs:
1. Your **tracking plan** (a simple JSON or CSV spec defining expected events and parameters)
2. Your **GA4 event export** (CSV from BigQuery or GA4 DebugView export)

It compares them and produces a structured audit report showing which events are missing, which parameters are wrong or absent, which events fire more than expected, and which events pass completely.

## Features

- Supports tracking plan in JSON or CSV format
- Parses GA4 BigQuery flat event export CSV
- Validates event name presence, parameter names, and parameter value types
- Detects events firing zero times vs. expected
- Detects unexpected events not in the tracking plan ("ghost events")
- Calculates a health score (0â100) for your GA4 implementation
- Exports full audit to JSON and human-readable Markdown report
- Zero external dependencies â runs on Node.js built-ins + one CSV parser

## Tech Stack

- Node.js 18+
- `csv-parse` â CSV parsing
- Built-in `fs`, `path` â file I/O

## Installation

```bash
git clone https://github.com/mehranmoghadasi/ga4-event-tracking-auditor.git
cd ga4-event-tracking-auditor
npm install
```

## Tracking Plan Format

Create a `tracking_plan.json`:

```json
{
  "events": [
    {
      "event_name": "purchase",
      "required_parameters": ["transaction_id", "value", "currency", "items"],
      "optional_parameters": ["coupon", "affiliation"],
      "expected_minimum_count": 1
    },
    {
      "event_name": "generate_lead",
      "required_parameters": ["form_id", "form_name"],
      "optional_parameters": ["page_location"],
      "expected_minimum_count": 1
    },
    {
      "event_name": "add_to_cart",
      "required_parameters": ["currency", "value", "items"],
      "optional_parameters": [],
      "expected_minimum_count": 5
    }
  ]
}
```

## Usage

```bash
node auditor.js \
  --plan tracking_plan.json \
  --events ga4_export.csv \
  --output ./audit_report/
```

## Sample Output

```
=== GA4 Event Tracking Audit â 2026-04-30 ===
Tracking Plan Events:    12
GA4 Events Analyzed:     9
Implementation Score:    67/100  â ï¸

â PASSING (5 events):
   page_view, session_start, scroll, click, file_download

â ï¸  MISSING PARAMETERS (2 events):
   purchase           â missing: currency, transaction_id
   generate_lead     0â missing: form_id

â NOT FIRING (3 events):
   add_to_cart
   begin_checkout
   view_item

ð» GHOST EVENTS (not in plan, found in data):
   gtm.js, gtm.click, undefined

Full report saved to: ./audit_report/
```

## MIT License

Copyright (c) 2026 Mehran Moghadasi
