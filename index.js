const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { Pool } = require('pg');
const http = require('http');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let memoryDB = {
  matches: {},
  users: {},
  bets: {},
  settings: { locked: false },
  nextMatchId: 1
};

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value JSONB)`);
    const res = await pool.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
    if (res.rows.length === 0) {
      await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', ['main_db', JSON.stringify(memoryDB)]);
    } else {
      const loaded = res.rows[0].value;
      memoryDB = {
        matches: loaded.matches || {},
        users: loaded.users || {},
        bets: loaded.bets || {},
        settings: loaded.settings || { locked: false },
        nextMatchId: loaded.nextMatchId || 1
      };
    }
    console.log('✅ Baza danych zainicjalizowana pomyślnie!');
  } catch (err) {
    console.error('❌ Błąd inicjalizacji bazy danych:', err);
  }
}

async function saveDB() {
  try {
    await pool.query(
      'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['main_db', JSON.stringify(memoryDB)]
    );
  } catch (err) {
    console.error('❌ Błąd zapisu bazy:', err);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot PGL Major Singapur 2026 dziala 24/7!\n');
});
server.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const slashCommands = [
  new SlashCommandBuilder().setName('mecze').setDescription('Wyświetla listę meczów do typowania'),
  new SlashCommandBuilder().setName('moje_typy').setDescription('Wyświetla Twoje typy'),
  new SlashCommandBuilder().setName('profil').setDescription('Twój profil'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking'),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Panel administracyjny')
    .addSubcommand(sub =>
      sub.setName('dodaj_mecz')
        .setDescription('Dodaj mecz')
        .addStringOption(opt => opt.setName('druzyna_a').setDescription('A').setRequired(true))
        .addStringOption(opt => opt.setName('druzyna_b').setDescription('B').setRequired(true))
        .addStringOption(opt => opt.setName('format').setDescription('Format').setRequired(true).addChoices({ name: 'BO1', value: 'BO1' }, { name: 'BO3', value: 'BO3' }))
        .addStringOption(opt => opt.setName('data_blokady').setDescription('DD-MM-YYYY HH:mm').setRequired(false))
    )
    .addSubcommand(sub => sub.setName('zablokuj').setDescription('Zablokuj mecz').addIntegerOption(opt => opt.setName('id').setDescription('ID').setRequired(true)))
].map(cmd => cmd.toJSON());

function getWarsawDate() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
  return new Date(nowStr);
}

function parseCustomDate(dateStr) {
  if (!dateStr) return null;
  try {
    const [datePart, timePart] = dateStr.trim().split(' ');
    const [day, month, year] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    return new Date(year, month - 1, day, hour, minute);
  } catch (e) { return null; }
}

async function checkAndLockMatches() {
  const now = getWarsawDate();
  let changed = false;
  for (const [mId, m] of Object.entries(memoryDB.matches)) {
    if (!m.locked && m.lockDate && now >= new Date(m.lockDate)) {
      m.locked = true;
      changed = true;
    }
  }
  if (changed) await saveDB();
}

client.once('ready', async () => {
  await initDB();
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
  setInterval(checkAndLockMatches, 30000);
  console.log('✅ Bot gotowy!');
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'mecze') {
        const matchKeys = Object.keys(memoryDB.matches);
        const selectOptions = [];
        for (const mId of matchKeys) {
          const m = memoryDB.matches[mId];
          if (!m || m.locked) continue;
          selectOptions.push({ label: `Mecz ${mId}: ${m.details}`, value: `typ_mecz_${mId}` });
        }
        if (selectOptions.length === 0) return interaction.reply({ content: 'Brak dostępnych meczów.', ephemeral: true });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_match_to_bet').setPlaceholder('Wybierz mecz...').addOptions(selectOptions));
        return interaction.reply({ content: 'Wybierz mecz:', components: [row], ephemeral: true });
      }
      if (interaction.commandName === 'admin' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'dodaj_mecz') {
          const teamA = interaction.options.getString('druzyna_a');
          const teamB = interaction.options.getString('druzyna_b');
          const format = interaction.options.getString('format');
          const lockStr = interaction.options.getString('data_blokady');
          const lockDateObj = parseCustomDate(lockStr);
          
          const mId = memoryDB.nextMatchId.toString();
          memoryDB.nextMatchId++;
          memoryDB.matches[mId] = {
            details: `${teamA} vs ${teamB}`,
            teamA, teamB, format,
            locked: false,
            lockDate: lockDateObj ? lockDateObj.toISOString() : null
          };
          await saveDB();
          return interaction.reply({ content: `✅ Dodano mecz ID ${mId}` });
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.DISCORD_TOKEN);
                                              
