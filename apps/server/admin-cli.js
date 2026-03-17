#!/usr/bin/env node
'use strict';

/**
 * Admin CLI — manage admin users from the server command line.
 *
 * This is the ONLY way to promote or demote admin users.
 * There is intentionally NO API endpoint that can grant admin access —
 * only the server operator (with shell access) can run this tool.
 *
 * Usage:
 *   node admin-cli.js promote <username>   — grant admin privileges
 *   node admin-cli.js demote  <username>   — revoke admin privileges
 *   node admin-cli.js list                 — list all admin users
 *
 * Examples:
 *   node admin-cli.js promote alice
 *   node admin-cli.js demote  bob
 *   node admin-cli.js list
 */

require('dotenv').config();
const db = require('./db');

const [,, command, username] = process.argv;

function usage() {
  console.log(`
Blink-Text Admin CLI
====================

Usage:
  node admin-cli.js promote <username>   Grant admin privileges to a user
  node admin-cli.js demote  <username>   Revoke admin privileges from a user
  node admin-cli.js list                 List all admin users

Security note:
  This CLI is the ONLY way to create admin users. There is no API
  endpoint that can grant admin access. Only the server operator
  with direct shell access can promote users to admin.
  `);
}

if (!command) {
  usage();
  process.exit(1);
}

switch (command) {
  case 'promote': {
    if (!username) {
      console.error('Error: username is required.\n  Usage: node admin-cli.js promote <username>');
      process.exit(1);
    }
    const user = db.prepare('SELECT id, username, is_admin, deleted_at FROM users WHERE username = ?').get(username);
    if (!user) {
      console.error(`Error: user "${username}" not found.`);
      process.exit(1);
    }
    if (user.deleted_at) {
      console.error(`Error: user "${username}" has been deleted.`);
      process.exit(1);
    }
    if (user.is_admin) {
      console.log(`User "${username}" is already an admin.`);
      process.exit(0);
    }
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
    console.log(`✅ User "${username}" has been promoted to admin.`);
    break;
  }

  case 'demote': {
    if (!username) {
      console.error('Error: username is required.\n  Usage: node admin-cli.js demote <username>');
      process.exit(1);
    }
    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').get(username);
    if (!user) {
      console.error(`Error: user "${username}" not found.`);
      process.exit(1);
    }
    if (!user.is_admin) {
      console.log(`User "${username}" is not an admin.`);
      process.exit(0);
    }
    db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(user.id);
    console.log(`✅ User "${username}" has been demoted from admin.`);
    break;
  }

  case 'list': {
    const admins = db.prepare('SELECT username, created_at FROM users WHERE is_admin = 1 AND deleted_at IS NULL').all();
    if (admins.length === 0) {
      console.log('No admin users found.\n  Use: node admin-cli.js promote <username>');
    } else {
      console.log(`Admin users (${admins.length}):`);
      for (const admin of admins) {
        const date = new Date(admin.created_at * 1000).toISOString().split('T')[0];
        console.log(`  • ${admin.username} (registered ${date})`);
      }
    }
    break;
  }

  default:
    console.error(`Unknown command: "${command}"`);
    usage();
    process.exit(1);
}
