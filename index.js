const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  PermissionsBitField 
} = require('discord.js');
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
  pickems: {
    stages: {},
    userPicks: {}
  },
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
        pickems: loaded.pickems || { stages: {}, userPicks: {} },
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serwer HTTP uruchomiony na porcie ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const slashCommands = [
  new SlashCommandBuilder().setName('mecze').setDescription('Wyświetla listę meczów do typowania'),
  new SlashCommandBuilder().setName('moje_typy').setDescription('🎯 Wyświetla Twoje obstawione mecze i typy'),
  new SlashCommandBuilder().setName('profil').setDescription('Twój profil i statystyki'),
  new SlashCommandBuilder().setName('ranking').setDescription('Tabela liderów turnieju'),
  new SlashCommandBuilder()
    .setName('pickem')
    .setDescription('Wybierz swoje typy Pick\'Em na dany stage')
    .addStringOption(opt => opt.setName('stage').setDescription('Wybierz stage').setRequired(true)
      .addChoices(
        { name: 'Stage 1 (Opening)', value: 'stage1' },
        { name: 'Stage 2 (Elimination)', value: 'stage2' },
        { name: 'Stage 3 (Playoffs)', value: 'stage3' }
      )),
  new SlashCommandBuilder().setName('moje_pickemy').setDescription('📋 Wyświetla Twoje zapisane Pick\'Emy'),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Panel administracyjny')
    .addSubcommand(sub =>
      sub.setName('dodaj_mecz')
        .setDescription('Dodaj nowy mecz')
        .addStringOption(opt => opt.setName('druzyna_a').setDescription('Drużyna A').setRequired(true))
        .addStringOption(opt => opt.setName('druzyna_b').setDescription('Drużyna B').setRequired(true))
        .addStringOption(opt => opt.setName('format').setDescription('Format').setRequired(true)
          .addChoices(
            { name: 'BO1', value: 'BO1' },
            { name: 'BO3', value: 'BO3' },
            { name: 'BO5', value: 'BO5' }
          ))
        .addStringOption(opt => opt.setName('data_blokady').setDescription('Data blokady np. 12-10-2026 12:00').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('zablokuj')
        .setDescription('Zablokuj mecz')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('rozlicz')
        .setDescription('Rozlicz oficjalne wyniki meczu i przyznaj punkty')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
        .addStringOption(opt => opt.setName('wynik').setDescription('Wynik (np. 2:1)').setRequired(true))
        .addStringOption(opt => opt.setName('zwyciezca').setDescription('Zwycięzca').setRequired(true))
        .addStringOption(opt => opt.setName('mvp').setDescription('MVP (Nick)').setRequired(true))
        .addStringOption(opt => opt.setName('mapa1').setDescription('Wynik Mapy 1').setRequired(false))
        .addStringOption(opt => opt.setName('mapa2').setDescription('Wynik Mapy 2').setRequired(false))
        .addStringOption(opt => opt.setName('mapa3').setDescription('Wynik Decidera').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_setup')
        .setDescription('Konfiguruj drużyny dla danego stage\'u Pick\'Em')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices(
            { name: 'Stage 1', value: 'stage1' },
            { name: 'Stage 2', value: 'stage2' },
            { name: 'Stage 3', value: 'stage3' }
          ))
        .addStringOption(opt => opt.setName('druzyny').setDescription('Lista drużyn oddzielona przecinkami').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_lock')
        .setDescription('Zablokuj/odblokuj typowanie Pick\'Em dla stage\'u')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices(
            { name: 'Stage 1', value: 'stage1' },
            { name: 'Stage 2', value: 'stage2' },
            { name: 'Stage 3', value: 'stage3' }
          ))
        .addBooleanOption(opt => opt.setName('status').setDescription('True = zablokuj, False = odblokuj').setRequired(true))
    )
].map(cmd => cmd.toJSON());

async function registerSlashCommands() {
  try {
    if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) return;
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log('✅ Komendy zarejestrowane!');
  } catch (err) {
    console.error('❌ Błąd rejestracji komend:', err);
  }
}

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
  } catch (e) {
    return null;
  }
}

async function checkAndLockMatches() {
  const now = getWarsawDate();
  let changed = false;

  for (const [mId, m] of Object.entries(memoryDB.matches)) {
    if (!m.locked && m.lockDate) {
      const lockTime = new Date(m.lockDate);
      if (now >= lockTime) {
        m.locked = true;
        changed = true;
        console.log(`🔒 Automatycznie zablokowano mecz ID ${mId}`);
      }
    }
  }

  if (changed) await saveDB();
}

function startAutoLockChecker() {
  setInterval(checkAndLockMatches, 30000);
}

client.once('ready', async () => {
  await initDB();
  console.log(`🤖 Zalogowano jako ${client.user.tag}!`);
  await registerSlashCommands();
  startAutoLockChecker();
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      if (commandName === 'mecze') {
        const matchKeys = Object.keys(memoryDB.matches);
        if (matchKeys.length === 0) return interaction.reply({ content: '📌 Brak aktywnych meczów.', ephemeral: true });

        let desc = 'Wybierz mecz do obstawienia:\n\n';
        const selectOptions = [];

        for (const mId of matchKeys) {
          const m = memoryDB.matches[mId];
          if (!m || m.locked) continue;
          desc += `• **ID ${mId}**: ${m.details} [${m.format}]\n`;
          selectOptions.push({
            label: `Mecz ${mId}:${m.details}`.substring(0, 100),
            description: `Format: ${m.format}`,
            value: `typ_mecz_${mId}`
          });
        }

        if (selectOptions.length === 0) return interaction.reply({ content: '🔒 Wszystkie mecze są zablokowane.', ephemeral: true });

        const embed = new EmbedBuilder().setTitle('🎮 Centrum Typowania').setDescription(desc).setColor(0xFF6B00);
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_match_to_bet').setPlaceholder('Wybierz mecz...').addOptions(selectOptions)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'moje_typy') {
        const userId = interaction.user.id;
        const userBets = [];

        for (const [mId, bets] of Object.entries(memoryDB.bets || {})) {
          if (bets[userId]) {
            const m = memoryDB.matches[mId] || { details: `Mecz ID ${mId}` };
            const b = bets[userId];
            let info = `• **${m.details}** (ID${mId}):\n  🎯 Wynik: \`${b.score}\` | ⭐ MVP: \`${b.mvp}\``;
            if (b.map1 !== 'Brak') info += `\n  🗺️ Mapa 1: \`${b.map1}\``;
            if (b.map2 !== 'Brak') info += `\n  🗺️ Mapa 2: \`${b.map2}\``;
            if (b.map3 !== 'Brak') info += `\n  🗺️ Decider: \`${b.map3}\``;
            userBets.push(info);
          }
        }

        if (userBets.length === 0) return interaction.reply({ content: '❓ Nie obstawiłeś jeszcze żadnego meczu.', ephemeral: true });

        const embed = new EmbedBuilder().setTitle(`🎯 Twoje Typy — ${interaction.user.username}`).setDescription(userBets.join('\n\n')).setColor(0x00FFCC);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'pickem') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];

        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage}** nie została jeszcze skonfigurowana przez administratora.`, ephemeral: true });
        }
        if (stageData.locked) {
          return interaction.reply({ content: `🔒 Faza **${stage}** jest obecnie zablokowana do typowania.`, ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_pickem_${stage}`).setTitle(`Pick'Em: ${stage.toUpperCase()}`);
        
        const t30 = new TextInputBuilder().setCustomId('p_30').setLabel('2 drużyny 3-0 (rozdziel przecinkami)').setStyle(TextInputStyle.Short).setRequired(true);
        const t03 = new TextInputBuilder().setCustomId('p_03').setLabel('2 drużyny 0-3 (rozdziel przecinkami)').setStyle(TextInputStyle.Short).setRequired(true);
        const tAdv = new TextInputBuilder().setCustomId('p_adv').setLabel('6 drużyn z awansem (rozdziel przecinkami)').setStyle(TextInputStyle.Paragraph).setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(t30),
          new ActionRowBuilder().addComponents(t03),
          new ActionRowBuilder().addComponents(tAdv)
        );

        return await interaction.showModal(modal);
      }

      if (commandName === 'moje_pickemy') {
        const userId = interaction.user.id;
        const userPicks = memoryDB.pickems.userPicks[userId];

        if (!userPicks || Object.keys(userPicks).length === 0) {
          return interaction.reply({ content: '📋 Nie masz jeszcze zapisanych żadnych typów Pick\'Em.', ephemeral: true });
        }

        let desc = '';
        for (const [stg, p] of Object.entries(userPicks)) {
          desc += `### 🏆 ${stg.toUpperCase()}\n`;
          desc += `• **3-0:** \`${p.threeZero}\`\n`;
          desc += `• **0-3:** \`${p.zeroThree}\`\n`;
          desc += `• **Awans (6):** \`${p.advancing}\`\n\n`;
        }

        const embed = new EmbedBuilder().setTitle(`📋 Twoje Pick'Emy — ${interaction.user.username}`).setDescription(desc).setColor(0x3498DB);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'profil') {
        const u = memoryDB.users[interaction.user.id] || { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        const winRate = u.settledCount > 0 ? Math.round(((u.exactHits + u.winnerHits) / u.settledCount) * 100) : 0;
        const embed = new EmbedBuilder()
          .setTitle(`📊 Profil: ${interaction.user.username}`)
          .setColor(0x00FFCC)
          .addFields(
            { name: '🏆 Punkty', value: `**${u.points} pkt**`, inline: true },
            { name: '🎯 Dokładne Wyniki', value: `**${u.exactHits}**`, inline: true },
            { name: '✅ Trafieni Zwycięzcy', value: `**${u.winnerHits}**`, inline: true },
            { name: '📈 Skuteczność', value: `**${winRate}%**`, inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'ranking') {
        const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: '🏆 Ranking jest pusty.', ephemeral: true });

        let desc = '';
        sorted.forEach(([id, data], i) => {
          let medal = `${i + 1}.`;
          if (i === 0) medal = '🥇'; else if (i === 1) medal = '🥈'; else if (i === 2) medal = '🥉';
          desc += `${medal} <@${id}> — **${data.points || 0} pkt**\n`;
        });

        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Klasyfikacja Generalna').setDescription(desc).setColor(0xFFD700)] });
      }

      if (commandName === 'admin') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
        }

        const sub = options.getSubcommand();

        if (sub === 'dodaj_mecz') {
          const teamA = options.getString('druzyna_a');
          const teamB = options.getString('druzyna_b');
          const format = options.getString('format');
          const lockStr = options.getString('data_blokady');

          let lockDateObj = null;
          if (lockStr) {
            lockDateObj = parseCustomDate(lockStr);
            if (!lockDateObj || isNaN(lockDateObj.getTime())) {
              return interaction.reply({ content: '❌ Błędny format daty! Użyj: `DD-MM-YYYY HH:mm`', ephemeral: true });
            }
          }

          const mId = memoryDB.nextMatchId.toString();
          memoryDB.nextMatchId++;
          memoryDB.matches[mId] = {
            details: `${teamA} vs${teamB}`,
            teamA, teamB, format,
            locked: false,
            lockDate: lockDateObj ? lockDateObj.toISOString() : null
          };

          await saveDB();
          return interaction.reply({ content: `✅ Dodano mecz ID **${mId}**: **${teamA} vs${teamB}** (${format})${lockStr ? ` [Blokada: ${lockStr}]` : ''}` });
        }

        if (sub === 'zablokuj') {
          const mId = options.getInteger('id').toString();
          if (!memoryDB.matches[mId]) return interaction.reply({ content: '❌ Nie znaleziono meczu.', ephemeral: true });
          memoryDB.matches[mId].locked = true;
          await saveDB();
          return interaction.reply({ content: `🔒 Zablokowano mecz ID **${mId}**.` });
        }

        if (sub === 'rozlicz') {
          const mId = options.getInteger('id').toString();
          const sScore = options.getString('wynik').trim();
          const sMVP = options.getString('mvp').trim().toLowerCase();
          const sM1 = (options.getString('mapa1') || '').trim();
          const sM2 = (options.getString('mapa2') || '').trim();
          const sM3 = (options.getString('mapa3') || '').trim();

          const match = memoryDB.matches[mId];
          if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu.', ephemeral: true });

          match.locked = true;
          let total = 0;

          for (const [uId, bet] of Object.entries(memoryDB.bets[mId] || {})) {
            total++;
            if (!memoryDB.users[uId]) memoryDB.users[uId] = { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
            const u = memoryDB.users[uId];
            u.settledCount++;

            if ((bet.score || '').trim() === sScore) {
              u.points += 3;
              u.exactHits++;
            } else {
              u.points += 1;
              u.winnerHits++;
            }

            if (sM1 && (bet.map1 || '').trim() === sM1) u.points += 2;
            if (sM2 && (bet.map2 || '').trim() === sM2) u.points += 2;
            if (sM3 && (bet.map3 || '').trim() === sM3) u.points += 2;
            if ((bet.mvp || '').trim().toLowerCase() === sMVP) u.points += 2;
          }

          await saveDB();
          return interaction.reply({ content: `🎉 Rozliczono mecz ID ${mId} dla${total} graczy!` });
        }

        if (sub === 'pickem_setup') {
          const stage = options.getString('stage');
          const teamsStr = options.getString('druzyny');
          const teams = teamsStr.split(',').map(t => t.trim()).filter(Boolean);

          if (!memoryDB.pickems.stages[stage]) {
            memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          }
          memoryDB.pickems.stages[stage].teams = teams;

          await saveDB();
          return interaction.reply({ content: `✅ Skonfigurowano stage **${stage}**. Dostępne drużyny (${teams.length}): \`${teams.join(', ')}\`` });
        }

        if (sub === 'pickem_lock') {
          const stage = options.getString('stage');
          const status = options.getBoolean('status');

          if (!memoryDB.pickems.stages[stage]) {
            memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          }
          memoryDB.pickems.stages[stage].locked = status;

          await saveDB();
          return interaction.reply({ content: `🔒 Status blokady dla **${stage}** zmieniony na: **${status ? 'Zablokowany' : 'Odblokowany'}**` });
        }
      }
    }

    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_match_to_bet') {
        const mId = interaction.values[0].replace('typ_mecz_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) return interaction.reply({ content: '❌ Mecz zablokowany lub niedostępny.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`modal_bet_${mId}`).setTitle(`Typowanie: ${match.details}`);
        const scoreInput = new TextInputBuilder().setCustomId('score_input').setLabel('Wynik serii (np. 2:0)').setStyle(TextInputStyle.Short).setRequired(true);
        const mvpInput = new TextInputBuilder().setCustomId('mvp_input').setLabel('MVP HLTV (Nick)').setStyle(TextInputStyle.Short).setRequired(true);

        const comps = [new ActionRowBuilder().addComponents(scoreInput)];

        if (match.format === 'BO3' || match.format === 'BO5') {
          const m1 = new TextInputBuilder().setCustomId('map1_input').setLabel(`Mapa 1 (${match.teamA})`).setStyle(TextInputStyle.Short).setRequired(false);
          const m2 = new TextInputBuilder().setCustomId('map2_input').setLabel(`Mapa 2 (${match.teamB})`).setStyle(TextInputStyle.Short).setRequired(false);
          const m3 = new TextInputBuilder().setCustomId('map3_input').setLabel(`Mapa 3 (Decider)`).setStyle(TextInputStyle.Short).setRequired(false);
          comp
