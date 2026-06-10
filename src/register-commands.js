// One-time (or after changes) slash command registration: npm run register

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';

const cad = new SlashCommandBuilder()
  .setName('cad')
  .setDescription('ERLC CAD controls')
  .addSubcommand(s => s.setName('join').setDescription('Join the dispatch voice channel and start listening'))
  .addSubcommand(s => s.setName('leave').setDescription('Leave the voice channel'))
  .addSubcommand(s => s.setName('units').setDescription('List all units and statuses'))
  .addSubcommand(s => s.setName('calls').setDescription('List open calls'))
  .addSubcommand(s => s.setName('bolos').setDescription('List active BOLOs'))
  .addSubcommand(s => s
    .setName('link')
    .setDescription('Link your Discord account (and optionally Roblox name) to a callsign')
    .addStringOption(o => o.setName('callsign').setDescription('e.g. 7-ADAM-12').setRequired(true))
    .addStringOption(o => o.setName('roblox').setDescription('Your Roblox username (for ERLC auto-sync)')));

const rest = new REST().setToken(config.token);
const appId = Buffer.from(config.token.split('.')[0], 'base64').toString();

await rest.put(Routes.applicationGuildCommands(appId, config.guildId), { body: [cad.toJSON()] });
console.log('Slash commands registered.');
