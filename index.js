const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, PermissionsBitField } = require('discord.js');
const { Pool } = require('pg');
const http = require('http');
const slashCommands = require('./commands.js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let memoryDB = {
  matches: {},
  users: {},
  bets: {},
  pickems: { stages: {}, userPicks: {}, mvpPicks: {} },
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
        pickems: {
          stages: loaded.pickems?.stages || {},
          userPicks: loaded.pickems?.userPicks || {},
          mvpPicks: loaded.pickems?.mvpPicks || {}
        },
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
server.listen(PORT, () => {
  console.log(`🌐 Serwer HTTP uruchomiony na porcie ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

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
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log('✅ Zarejestrowano komendy Slash w Discordzie!');
  } catch (err) {
    console.error('❌ Błąd podczas rejestracji komend Slash:', err);
  }
  setInterval(checkAndLockMatches, 30000);
  console.log(`✅ Bot ${client.user.tag} jest gotowy do działania!`);
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      if (commandName === 'mecze') {
        const matchKeys = Object.keys(memoryDB.matches);
        const selectOptions = [];
        for (const mId of matchKeys) {
          const m = memoryDB.matches[mId];
          if (!m || m.locked) continue;
          selectOptions.push({ label: `Mecz ID ${mId}: ${m.details}`, value: `typ_mecz_${mId}` });
        }
        if (selectOptions.length === 0) return interaction.reply({ content: 'Brak dostępnych meczów do typowania.', ephemeral: true });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_match_to_bet').setPlaceholder('Wybierz mecz...').addOptions(selectOptions));
        return interaction.reply({ content: 'Wybierz mecz z listy:', components: [row], ephemeral: true });
      }

      if (commandName === 'druzyny') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];
        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage.toUpperCase()}** nie została jeszcze skonfigurowana.`, ephemeral: true });
        }
        const teamsList = stageData.teams.map((team, index) => `${index + 1}. **${team}**`).join('\n');
        const embed = new EmbedBuilder().setTitle(`🛡️ Drużyny w ${stage.toUpperCase()}`).setDescription(teamsList).setColor('#0099ff');
        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      if (commandName === 'moje_typy') {
        const userId = interaction.user.id;
        const userBets = memoryDB.bets[userId];
        if (!userBets || Object.keys(userBets).length === 0) {
          return interaction.reply({ content: '📋 Nie obstawiłeś jeszcze żadnego meczu.', ephemeral: true });
        }
        let desc = '### 🎯 Twoje typy:\n';
        for (const [mId, b] of Object.entries(userBets)) {
          const match = memoryDB.matches[mId];
          const details = match ? match.details : `Mecz ID ${mId}`;
          desc += `• **${details}**: Wygrana \`\${b.winner}\` | Wynik \`\${b.score}\` | MVP: \`\${b.mvp || 'Brak'}\`\n`;
        }
        return interaction.reply({ content: desc, ephemeral: true });
      }

      if (commandName === 'pickem') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];
        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage}** nie jest skonfigurowana.`, ephemeral: true });
        }
        if (stageData.locked) {
          return interaction.reply({ content: `🔒 Faza jest zablokowana.`, ephemeral: true });
        }
        const modal = new ModalBuilder().setCustomId(`modal_pickem_${stage}`).setTitle(`Pick'Em: ${stage.toUpperCase()}`);
        const t30 = new TextInputBuilder().setCustomId('p_30').setLabel('2 drużyny 3-0 (po przecinku)').setStyle(TextInputStyle.Short).setRequired(true);
        const t03 = new TextInputBuilder().setCustomId('p_03').setLabel('2 drużyny 0-3 (po przecinku)').setStyle(TextInputStyle.Short).setRequired(true);
        const tAdv = new TextInputBuilder().setCustomId('p_adv').setLabel('6 drużyn z awansem (po przecinku)').setStyle(TextInputStyle.Paragraph).setRequired(true);
        const comps = [new ActionRowBuilder().addComponents(t30), new ActionRowBuilder().addComponents(t03), new ActionRowBuilder().addComponents(tAdv)];
        if (stage === 'stage3') {
          const tMvp = new TextInputBuilder().setCustomId('p_mvp').setLabel('MVP Turnieju (Nick)').setStyle(TextInputStyle.Short).setRequired(false);
          comps.push(new ActionRowBuilder().addComponents(tMvp));
        }
        modal.addComponents(comps);
        return await interaction.showModal(modal);
      }

      if (commandName === 'moje_pickemy') {
        const userId = interaction.user.id;
        const userPicks = memoryDB.pickems.userPicks[userId];
        const userMvp = memoryDB.pickems.mvpPicks?.[userId];
        if ((!userPicks || Object.keys(userPicks).length === 0) && !userMvp) {
          return interaction.reply({ content: '📋 Brak zapisanych Pick\'Emów.', ephemeral: true });
        }
        let desc = '';
        if (userPicks) {
          for (const [stg, p] of Object.entries(userPicks)) {
            desc += `### 🏆 \${stg.toUpperCase()}\n• **3-0:** \`\${p.threeZero}\`\n• **0-3:** \`\${p.zeroThree}\`\n• **Awans:** \`\${p.advancing}\`\n\n`;
          }
        }
        if (userMvp) desc += `🌟 **MVP Turnieju:** \`\${userMvp}\`\n`;
        return interaction.reply({ content: desc, ephemeral: true });
      }

      if (commandName === 'profil') {
        const u = memoryDB.users[interaction.user.id] || { points: 0 };
        return interaction.reply({ content: `📊 Twój profil:\n🏆 Punkty: **\${u.points} pkt**`, ephemeral: true });
      }

      if (commandName === 'ranking') {
        const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: '🏆 Ranking jest pusty.', ephemeral: true });
        let desc = '';
        sorted.forEach(([id, data], i) => { desc += `\${i + 1}. <@\${id}> — **\${data.points || 0} pkt**\n`; });
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Tabela Liderów').setDescription(desc)] });
      }

      if (commandName === 'admin' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const sub = options.getSubcommand();

        if (sub === 'dodaj_mecz') {
          const teamA = options.getString('druzyna_a');
          const teamB = options.getString('druzyna_b');
          const format = options.getString('format');
          const lockDateObj = parseCustomDate(options.getString('data_blokady'));
          const mId = memoryDB.nextMatchId.toString();
          memoryDB.nextMatchId++;
          memoryDB.matches[mId] = { details: `\${teamA} vs \${teamB}`, teamA, teamB, format, locked: false, lockDate: lockDateObj ? lockDateObj.toISOString() : null };
          await saveDB();
          return interaction.reply({ content: `✅ Dodano mecz ID \${mId}: **\${teamA} vs \**\${teamB}** (\${format})` });
        }

        if (sub === 'rozlicz_mecz') {
          const mId = options.getInteger('id').toString();
          const winner = options.getString('zwyciezca').trim().toLowerCase();
          const exactScore = options.getString('wynik').trim().replace(/\s+/g, '');
          const officialMvp = options.getString('mvp_mecz')?.trim().toLowerCase() || null;
          const match = memoryDB.matches[mId];
          if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu.', ephemeral: true });

          let processed = 0, mvpCount = 0;
          for (const [userId, bets] of Object.entries(memoryDB.bets)) {
            const b = bets[mId];
            if (!b) continue;
            if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };
            if (b.winner.trim().toLowerCase() === winner) {
              if (b.score.trim().replace(/\s+/g, '') === exactScore) memoryDB.users[userId].points += 3;
              else memoryDB.users[userId].points += 1;
              processed++;
            }
            if (officialMvp && b.mvp && b.mvp.trim().toLowerCase() === officialMvp) {
              memoryDB.users[userId].points += 1;
              mvpCount++;
            }
          }
          match.locked = true;
          await saveDB();
          return interaction.reply({ content: `🎉 Rozliczono mecz ID \${mId}. Przyznano punkty \${processed} graczom (MVP: \${mvpCount}).` });
        }

        if (sub === 'pickem_setup') {
          const stage = options.getString('stage');
          const teams = options.getString('druzyny').split(',').map(t => t.trim()).filter(Boolean);
          if (!memoryDB.pickems.stages[stage]) memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          memoryDB.pickems.stages[stage].teams = teams;
          await saveDB();
          return interaction.reply({ content: `✅ Skonfigurowano stage \${stage} (\${teams.length} drużyn).` });
        }

        if (sub === 'pickem_lock') {
          const stage = options.getString('stage');
          const status = options.getBoolean('status');
          if (!memoryDB.pickems.stages[stage]) memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          memoryDB.pickems.stages[stage].locked = status;
          await saveDB();
          return interaction.reply({ content: `🔒 Blokada \${stage}: \${status}` });
        }

        if (sub === 'pickem_rozlicz') {
          const stage = options.getString('stage');
          const off30 = options.getString('oficjalne_30').split(',').map(t => t.trim().toLowerCase());
          const off03 = options.getString('oficjalne_03').split(',').map(t => t.trim().toLowerCase());
          const offAdv = options.getString('oficjalne_adv').split(',').map(t => t.trim().toLowerCase());
          let count = 0;
          for (const [userId, stgs] of Object.entries(memoryDB.pickems.userPicks || {})) {
            const p = stgs[stage];
            if (!p) continue;
            if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };
            let pts = 0;
            p.threeZero?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (off30.includes(t)) pts += 3; });
            p.zeroThree?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (off03.includes(t)) pts += 3; });
            p.advancing?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (offAdv.includes(t)) pts += 1; });
            memoryDB.users[userId].points += pts;
            count++;
          }
          await saveDB();
          return interaction.reply({ content: `🎉 Rozliczono Pick'Em dla \${stage} (\${count} graczy).` });
        }

        if (sub === 'pickem_rozlicz_mvp') {
          const offMvp = options.getString('gracz_mvp').trim().toLowerCase();
          let count = 0;
          for (const [userId, mvp] of Object.entries(memoryDB.pickems.mvpPicks || {})) {
            if (mvp.trim().toLowerCase() === offMvp) {
              if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };
              memoryDB.users[userId].points += 3;
              count++;
            }
          }
          await saveDB();
          return interaction.reply({ content: `🌟 Rozliczono MVP (\${offMvp}): +3 pkt dla \${count} graczy.` });
        }

        if (sub === 'reset_ranking') {
          memoryDB.users = {};
          await saveDB();
          return interaction.reply({ content: '⚠️ Zresetowano ranking!', ephemeral: true });
        }
      }
    }

    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_match_to_bet') {
        const mId = interaction.values[0].replace('typ_mecz_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) return interaction.reply({ content: '❌ Mecz niedostępny.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_bet_match_\${mId}`).setTitle(`Obstaw: \${match.details}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b_winner').setLabel(`Zwycięzca (\${match.teamA}/\${match.teamB})`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b_score').setLabel('Wynik (np. 13-8 / 2-1)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b_mvp').setLabel('MVP meczu (opcjonalnie)').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }
    }

    else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_bet_match_')) {
        const mId = interaction.customId.replace('modal_bet_match_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) return interaction.reply({ content: '❌ Błąd.', ephemeral: true });
        const winner = interaction.fields.getTextInputValue('b_winner').trim();
        const score = interaction.fields.getTextInputValue('b_score').trim();
        const mvp = interaction.fields.getTextInputValue('b_mvp').trim() || 'Brak';
        if (!memoryDB.bets[interaction.user.id]) memoryDB.bets[interaction.user.id] = {};
        memoryDB.bets[interaction.user.id][mId] = { winner, score, mvp };
        await saveDB();
        return interaction.reply({ content: `🎯 Zapisano typ na \${match.details}!`, ephemeral: true });
      }

      if (interaction.customId.startsWith('modal_pickem_')) {
        const stage = interaction.customId.replace('modal_pickem_', '');
        const t30 = interaction.fields.getTextInputValue('p_30').trim();
        const t03 = interaction.fields.getTextInputValue('p_03').trim();
        const tAdv = interaction.fields.getTextInputValue('p_adv').trim();
        if (!memoryDB.pickems.userPicks[interaction.user.id]) memoryDB.pickems.userPicks[interaction.user.id] = {};
        memoryDB.pickems.userPicks[interaction.user.id][stage] = { threeZero: t30, zeroThree: t03, advancing: tAdv };
        if (stage === 'stage3') {
          const mvp = interaction.fields.getTextInputValue('p_mvp')?.trim();
          if (mvp) {
            if (!memoryDB.pickems.mvpPicks) memoryDB.pickems.mvpPicks = {};
            memoryDB.pickems.mvpPicks[interaction.user.id] = mvp;
          }
        }
        await saveDB();
        return interaction.reply({ content: `✅ Zapisano Pick'Em dla \${stage}!`, ephemeral: true });
      }
    }
  } catch (e) {
    console.error('Błąd:', e);
  }
});

client.login(process.env.DISCORD_TOKEN);
          
