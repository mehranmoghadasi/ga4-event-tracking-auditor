#!/usr/bin/env node
/**
 * ga4-event-tracking-auditor/auditor.js
 *
 * Validates GA4 event tracking implementation against a defined tracking plan.
 * Identifies missing events, broken parameters, and ghost events.
 *
 * Author: Mehran Moghadasi
 * License: MIT
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

// ---------------------------------------------------------------------------
// CLI ARGUMENT PARSER
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    plan: null,
    events: null,
    output: "./audit_report/",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan") opts.plan = args[++i];
    if (args[i] === "--events") opts.events = args[++i];
    if (args[i] === "--output") opts.output = args[++i];
  }

  if (!opts.plan || !opts.events) {
    console.error("Usage: node auditor.js --plan <tracking_plan.json> --events <ga4_export.csv> [--output ./report/]");
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// TRACKING PLAN LOADER
// ---------------------------------------------------------------------------
function loadTrackingPlan(filepath) {
  const ext = path.extname(filepath).toLowerCase();

  if (ext === ".json") {
    const raw = fs.readFileSync(filepath, "utf-8");
    const data = JSON.parse(raw);
    // Normalize: accept { events: [...] } or bare array
    return Array.isArray(data) ? data : data.events || [];
  }

  if (ext === ".csv") {
    const raw = fs.readFileSync(filepath, "utf-8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true });
    // CSV format: event_name, required_parameters (comma in quotes), optional_parameters, expected_minimum_count
    return rows.map((row) => ({
      event_name: row.event_name.trim(),
      required_parameters: row.required_parameters
        ? row.required_parameters.split("|").map((p) => p.trim()).filter(Boolean)
        : [],
      optional_parameters: row.optional_parameters
        ? row.optional_parameters.split("|").map((p) => p.trim()).filter(Boolean)
        : [],
      expected_minimum_count: parseInt(row.expected_minimum_count || "1", 10),
    }));
  }

  throw new Error(`Unsupported tracking plan format: ${ext}. Use .json or .csv`);
}

// ---------------------------------------------------------------------------
// GA4 EVENT EXPORT LOADER
// ---------------------------------------------------------------------------
/**
 * Parses a GA4 event export CSV (BigQuery flat export format).
 * Expected columns: event_name, event_params_key, event_params_value_string,
 *   event_params_value_int, event_params_value_float, event_params_value_double
 *
 * Returns a Map: event_name -> { count, params: Set<paramName> }
 */
function loadGA4Events(filepath) {
  const raw = fs.readFileSync(filepath, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });

  const eventMap = new Map();

  for (const row of rows) {
    const eventName = (row.event_name || "").trim();
    if (!eventName) continue;

    if (!eventMap.has(eventName)) {
      eventMap.set(eventName, { count: 0, params: new Set() });
    }

    const entry = eventMap.get(eventName);
    entry.count += 1;

    // Collect parameter keys
    const paramKey = (row.event_params_key || row.key || "").trim();
    if (paramKey) {
      entry.params.add(paramKey);
    }
  }

  return eventMap;
}

// ---------------------------------------------------------------------------
// AUDIT ENGINE
// ---------------------------------------------------------------------------
/**
 * Compares tracking plan against actual GA4 events.
 * Returns structured audit results.
 */
function runAudit(trackingPlan, ga4Events) {
  const results = {
    passing: [],
    missingParameters: [],
    notFiring: [],
    ghostEvents: [],
    planEventNames: new Set(trackingPlan.map((e) => e.event_name)),
  };

  // Audit each planned event
  for (const plannedEvent of trackingPlan) {
    const { event_name, required_parameters, expected_minimum_count } = plannedEvent;

    if (!ga4Events.has(event_name)) {
      results.notFiring.push({ event_name, reason: "Event not found in export" });
      continue;
    }

    const actual = ga4Events.get(event_name);

    if (actual.count < expected_minimum_count) {
      results.notFiring.push({
        event_name,
        reason: `Fired ${actual.count}x, expected â¥${expected_minimum_count}`,
      });
      continue;
    }

    // Check required parameters
    const missingParams = required_parameters.filter(
      (param) => !actual.params.has(param)
    );

    if (missingParams.length > 0) {
      results.missingParameters.push({
        event_name,
        missing_parameters: missingParams,
        found_parameters: Array.from(actual.params),
      });
    } else {
      results.passing.push({
        event_name,
        count: actual.count,
        parameters_validated: required_parameters.length,
      });
    }
  }

  // Ghost events: in GA4 data but not in tracking plan
  for (const [eventName] of ga4Events) {
    if (!results.planEventNames.has(eventName)) {
      // Filter out GA4 automatic events that are expected outside the plan
      const autoEvents = new Set([
        "first_visit", "user_engagement", "session_start", "page_view",
        "scroll", "click", "file_download", "video_start", "video_complete",
      ]);
      if (!autoEvents.has(eventName)) {
        results.ghostEvents.push({ event_name: eventName });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// HEALTH SCORE CALCULATOR
// ---------------------------------------------------------------------------
function calculateHealthScore(results, totalPlanEvents) {
  if (totalPlanEvents === 0) return 0;
  const passing = results.passing.length;
  const partial = results.missingParameters.length * 0.5; // partial credit
  return Math.round(((passing + partial) / totalPlanEvents) * 100);
}

// ---------------------------------------------------------------------------
// REPORT GENERATOR
// ---------------------------------------------------------------------------
function generateMarkdownReport(results, score, date) {
  const lines = [
    `# GA4 Event Tracking Audit Report`,
    `**Date:** ${date}`,
    `**Implementation Health Score:** ${score}/100`,
    "",
  ];

  lines.push(`## â Passing Events (${results.passing.length})`);
  if (results.passing.length === 0) {
    lines.push("_None_");
  } else {
    for (const e of results.passing) {
      lines.push(`- \`${e.event_name}\` â ${e.count} occurrences, ${e.parameters_validated} params validated`);
    }
  }

  lines.push("", `## â ï¸ Missing Parameters (${results.missingParameters.length})`);
  for (const e of results.missingParameters) {
    lines.push(`- \`${e.event_name}\``);
    lines.push(`  - Missing: \`${e.missing_parameters.join("`, `")}\``);
    lines.push(`  - Found: \`${e.found_parameters.join("`, `") || "none"}\``);
  }

  lines.push("", `## â Not Firing (${results.notFiring.length})`);
  for (const e of results.notFiring) {
    lines.push(`- \`${e.event_name}\` â ${e.reason}`);
  }

  lines.push("", `## ð» Ghost Events â Not in Tracking Plan (${results.ghostEvents.length})`);
  for (const e of results.ghostEvents) {
    lines.push(`- \`${e.event_name}\``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CONSOLE SUMMARY
// ---------------------------------------------------------------------------
function printSummary(results, score, totalPlanEvents) {
  const scoreEmoji = score >= 90 ? "â" : score >= 70 ? "â ï¸" : "â";
  console.log(`\n=== GA4 Event Tracking Audit ===`);
  console.log(`Tracking Plan Events:    ${totalPlanEvents}`);
  console.log(`Implementation Score:    ${score}/100  ${scoreEmoji}`);
  console.log(`\nâ PASSING (${results.passing.length}):`);
  console.log("   " + (results.passing.map((e) => e.event_name).join(", ") || "none"));
  console.log(`\nâ ï¸  MISSING PARAMETERS (${results.missingParameters.length}):`);
  for (const e of results.missingParameters) {
    console.log(`   ${e.event_name.padEnd(20)} â missing: ${e.missing_parameters.join(", ")}`);
  }
  console.log(`\nâ NOT FIRING (${results.notFiring.length}):`);
  for (const e of results.notFiring) {
    console.log(`   ${e.event_name} â ${e.reason}`);
  }
  console.log(`\nð» GHOST EVENTS (${results.ghostEvents.length}):`);
  console.log("   " + (results.ghostEvents.map((e) => e.event_name).join(", ") || "none"));
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();
  const date = new Date().toISOString().slice(0, 10);

  console.log(`[start] Loading tracking plan: ${opts.plan}`);
  const trackingPlan = loadTrackingPlan(opts.plan);
  console.log(`[info]  Plan has ${trackingPlan.length} events`);

  console.log(`[start] Loading GA4 event export: ${opts.events}`);
  const ga4Events = loadGA4Events(opts.events);
  console.log(`[info]  Export has ${ga4Events.size} unique event names`);

  console.log(`[start] Running audit...`);
  const results = runAudit(trackingPlan, ga4Events);
  const score = calculateHealthScore(results, trackingPlan.length);

  printSummary(results, score, trackingPlan.length);

  // Save outputs
  fs.mkdirSync(opts.output, { recursive: true });

  const mdReport = generateMarkdownReport(results, score, date);
  const mdPath = path.join(opts.output, `ga4_audit_${date}.md`);
  fs.writeFileSync(mdPath, mdReport);
  console.log(`\n[saved] ${mdPath}`);

  const jsonPath = path.join(opts.output, `ga4_audit_${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ score, date, results }, null, 2));
  console.log(`[saved] ${jsonPath}`);

  console.log(`\n[done] Audit complete. Score: ${score}/100`);
}

main();
