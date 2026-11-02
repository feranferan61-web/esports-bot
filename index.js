const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes } = require('discord.js');
const { Pool } = require('pg');
const http = require('http');
const slashCommands = require('./commands.js');
const THEME_COLOR = '#8B0000'; // Ciemny czerwony (motyw PGL Major)


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let memoryDB = {
  matches: {},
  users: {},
  bets: {},
  pickems: { stages: {}, userPicks: {} },
  userChannels: {},
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
          userPicks: loaded.pickems?.userPicks || {}
        },
        userChannels: loaded.userChannels || {},
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
  res.end('Bot Major 2026 dziala 24/7!\n');
});
server.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

function getWarsawDate() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
  return new Date(nowStr);
}

function parseWarsawDate(dateStr) {
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
    if (!m.locked && m.closeDate && now >= new Date(m.closeDate)) {
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
    console.log('✅ Zarejestrowano komendy Slash!');
  } catch (err) {
    console.error('❌ Błąd rejestracji komend:', err);
  }
  setInterval(checkAndLockMatches, 30000);
  console.log(`✅ Bot ${client.user.tag} jest gotowy!`);
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();

    if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

      if (commandName === 'mojpickem') {
        const stage = options.getString('stage');
        const userPicks = memoryDB.pickems?.userPicks?.[interaction.user.id]?.[stage];
        if (!userPicks) {
          return interaction.reply({ content: 'Nie masz jeszcze zapisanych typów Pick\'Em dla tej fazy.', ephemeral: true });
        }
        return interaction.reply({ content: `Twoje typy (${stage}): 3-0: ${userPicks.threeZero}, 0-3: ${userPicks.zeroThree}, Awans: ${userPicks.advancing}`, ephemeral: true });
      }
    

        const embed = new EmbedBuilder()
          .setTitle(`🎯 Twoje typy Pick'Em — Faza ${stage.toUpperCase()}`)
          .setColor(THEME_COLOR)
          .addFields(
            { name: '🔥 Bilans 3-0', value: userPicks.threeZero || '*Brak*', inline: true },
            { name: '💀 Bilans 0-3', value: userPicks.zeroThree || '*Brak*', inline: true },
            { name: '✅ Awans (3-1 / 3-2)', value: userPicks.advancing || '*Brak*', inline: false }
          )
          .setFooter({ text: 'PGL Major Singapore 2026 • Statystyki typerów' })
          .setTimestamp();

        return interaction.reply({ 
          embeds: [embed], 
          ephemeral: true 
        });
        }
    
      

      if (commandName === 'mecze') {
        const selectOptions = [];
        for (const [mId, m] of Object.entries(memoryDB.matches)) {
          if (m.locked) continue;
          selectOptions.push({ label: `Mecz ID ${mId}: ${m.details} (${m.format})`, value: `bet_match_${mId}` });
        }
        if (selectOptions.length === 0) {
          return interaction.reply({ content: 'Brak dostępnych meczów do typowania.', ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_match_menu').setPlaceholder('Wybierz mecz...').addOptions(selectOptions)
        );
        return interaction.reply({ content: 'Wybierz mecz:', components: [row], ephemeral: true });
      }

      if (commandName === 'mojetypy') {
        const userId = interaction.user.id;
        const userBets = memoryDB.bets[userId];
        if (!userBets || Object.keys(userBets).length === 0) {
          return interaction.reply({ content: 'Nie masz jeszcze typów.', ephemeral: true });
        }
        let desc = '### Twoje typy:\n';
        for (const [mId, b] of Object.entries(userBets)) {
          const match = memoryDB.matches[mId];
          desc += `• **${match ? match.details : 'Mecz ' + mId}** -> ${b.winner} (${b.score})\n`;
        }
        return interaction.reply({ content: desc, ephemeral: true });
      }

            if (commandName === 'profil') {
        const targetUser = options.getUser('gracz') || interaction.user;
        const uData = memoryDB.users[targetUser.id] || { points: 0, matchStats: { total: 0, correct: 0 }, pickemStats: { total: 0, correct: 0 } };
        
        const mStats = uData.matchStats || { total: 0, correct: 0 };
        const pStats = uData.pickemStats || { total: 0, correct: 0 };

        const matchAcc = mStats.total > 0 ? ((mStats.correct / mStats.total) * 100).toFixed(1) : 0;
        const pickemAcc = pStats.total > 0 ? ((pStats.correct / pStats.total) * 100).toFixed(1) : 0;

        const embed = new EmbedBuilder()
          .setTitle(`📊 Profil Gracza — ${targetUser.username}`)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setColor(THEME_COLOR)
          .addFields(
            { name: '🏆 Punkty ogółem', value: `**${uData.points} pkt**`, inline: false },
            { name: '⚔️ Typowanie Meczy', value: `Trafienia: **${mStats.correct}/${mStats.total}**\nSkuteczność: **${matchAcc}%**`, inline: true },
            { name: '🎯 Pick\'Em', value: `Trafienia: **${pStats.correct}/${pStats.total}**\nSkuteczność: **${pickemAcc}%**`, inline: true }
          )
          .setFooter({ text: 'PGL Major Singapore 2026' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
            }
      
      
          content: `📊 **Twój Profil Typera:**\n` +
                   `🏆 Łączne punkty: **${u.points} pkt**\n\n` +
                   `📆 **Mecze:**\n` +
                   `• Obstawione: **${mStats.total}**\n` +
                   `• Trafione: **${mStats.correct}**\n` +
                   `• Skuteczność: **${matchAcc}%**\n\n` +
                   `🛡️ **Pick'Em:**\n` +
                   `• Obstawione typy: **${pStats.total}**\n` +
                   `• Trafione typy: **${pStats.correct}**\n` +
                   `• Skuteczność: **${pickemAcc}%**`,
          ephemeral: true
        });
    }
      

      if (commandName === 'ranking') {
        const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: 'Ranking jest pusty.', ephemeral: true });
        let desc = '';
        sorted.forEach(([id, data], i) => { desc += `${i + 1}. <@${id}> — ${data.points || 0} pkt\n`; });
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('TOP 10').setDescription(desc)] });
      }

      if (commandName === 'moj_kanal') {
        const guild = interaction.guild;
        const user = interaction.user;
        if (!memoryDB.userChannels) memoryDB.userChannels = {};
        if (memoryDB.userChannels[user.id]) {
          const ch = guild.channels.cache.get(memoryDB.userChannels[user.id]);
          if (ch) return interaction.reply({ content: `Masz już kanał: <#${ch.id}>`, ephemeral: true });
        }
        const channel = await guild.channels.create({
          name: `typy-${user.username}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
          type: 0,
          permissionOverwrites: [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] }
          ]
        });
        memoryDB.userChannels[user.id] = channel.id;
        await saveDB();
        return interaction.reply({ content: `Stworzono kanał: <#${channel.id}>`, ephemeral: true });
      }

      if (commandName === 'druzyny') {
        const stage = options.getString('stage');
        const data = memoryDB.pickems.stages[stage];
        if (!data || !data.teams?.length) return interaction.reply({ content: 'Faza nieskonfigurowana.', ephemeral: true });
        return interaction.reply({ content: data.teams.join(', ') });
      }

      if (commandName === 'pickem') {
        const stage = options.getString('stage');
        const data = memoryDB.pickems.stages[stage];
        if (!data || !data.teams?.length) return interaction.reply({ content: 'Faza nieskonfigurowana.', ephemeral: true });
        if (data.locked) return interaction.reply({ content: 'Zablokowane.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_pickem_${stage}`).setTitle(`Pick'Em ${stage}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_30').setLabel('3-0').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_03').setLabel('0-3').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_adv').setLabel('Awans (6)').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (commandName === 'dodajmecz') {
        const tA = options.getString('druzyna_a'), tB = options.getString('druzyna_b'), fmt = options.getString('format');
        const closeDate = parseWarsawDate(options.getString('data_zamkniecia'));
        if (!closeDate) return interaction.reply({ content: 'Błędna data (DD-MM-YYYY HH:mm).', ephemeral: true });
        
        const mId = memoryDB.nextMatchId.toString();
        memoryDB.nextMatchId += 1;

        memoryDB.matches[mId] = { details: `${tA} vs ${tB}`, teamA: tA, teamB: tB, format: fmt, closeDate: closeDate.toISOString(), locked: false };
        await saveDB();
        return interaction.reply({ content: `Dodano mecz ID ${mId}` });
      }

      if (commandName === 'edytujmecz') {
        const mId = options.getInteger('id').toString();
        const m = memoryDB.matches[mId];
        if (!m) return interaction.reply({ content: 'Nie znaleziono meczu.', ephemeral: true });
        if (options.getString('druzyna_a')) m.teamA = options.getString('druzyna_a');
        if (options.getString('druzyna_b')) m.teamB = options.getString('druzyna_b');
        m.details = `${m.teamA} vs ${m.teamB}`;
        if (options.getString('format')) m.format = options.getString('format');
        const dStr = options.getString('data_zamkniecia');
        if (dStr) {
          const d = parseWarsawDate(dStr);
          if (d) { m.closeDate = d.toISOString(); m.locked = false; }
        }
        await saveDB();
        return interaction.reply({ content: `Zaktualizowano mecz ID ${mId}` });
      }

      if (commandName === 'usunmecz') {
        const mId = options.getInteger('id').toString();
        delete memoryDB.matches[mId];
        await saveDB();
        return interaction.reply({ content: `Usunięto mecz ID ${mId}` });
      }

      if (commandName === 'rozliczmecz') {
        const mId = options.getInteger('id').toString();
        const winner = options.getString('zwyciezca').trim().toLowerCase();
        const score = options.getString('wynik').trim().replace(/\s+/g, '');
        const match = memoryDB.matches[mId];
        if (!match) return interaction.reply({ content: 'Nie znaleziono meczu.', ephemeral: true });

        for (const [uId, bets] of Object.entries(memoryDB.bets)) {
          const b = bets[mId];
          if (!b) continue;
          if (!memoryDB.users[uId]) memoryDB.users[uId] = { points: 0, totalBets: 0, correctBets: 0 };
          memoryDB.users[uId].totalBets++;
          if (b.winner.trim().toLowerCase() === winner) {
            if (b.score.trim().replace(/\s+/g, '') === score) {
              memoryDB.users[uId].points += 3;
              memoryDB.users[uId].correctBets++;
              b.result = 3;
            } else {
              memoryDB.users[uId].points += 1;
              memoryDB.users[uId].correctBets++;
              b.result = 1;
            }
          } else {
            b.result = 0;
          }
        }
        delete memoryDB.matches[mId];
        await saveDB();
        return interaction.reply({ content: `Rozliczono mecz ID ${mId}` });
      }

      if (commandName === 'utworzpickem') {
        const stage = options.getString('stage');
        const teams = options.getString('druzyny').split(',').map(t => t.trim()).filter(Boolean);
        if (!memoryDB.pickems.stages[stage]) memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
        memoryDB.pickems.stages[stage].teams = teams;
        await saveDB();
        return interaction.reply({ content: `Skonfigurowano ${stage}` });
      }
      if (commandName === 'rozliczpickem') {
        const stage = options.getString('stage');
        const off30 = options.getString('oficjalne_30').split(',').map(t => t.trim().toLowerCase());
        const off03 = options.getString('oficjalne_03').split(',').map(t => t.trim().toLowerCase());
        const offAdv = options.getString('oficjalne_awans').split(',').map(t => t.trim().toLowerCase());

        for (const [uId, stages] of Object.entries(memoryDB.pickems.userPicks || {})) {
          const p = stages[stage];
          if (!p) continue;

          if (!memoryDB.users[uId]) {
            memoryDB.users[uId] = { points: 0, matchStats: { total: 0, correct: 0 }, pickemStats: { total: 0, correct: 0 } };
          }
          if (!memoryDB.users[uId].pickemStats) {
            memoryDB.users[uId].pickemStats = { total: 0, correct: 0 };
          }

          let pts = 0;

          // Rozliczanie 3-0
          const t30List = p.threeZero?.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) || [];
          t30List.forEach(t => {
            memoryDB.users[uId].pickemStats.total++;
            if (off30.includes(t)) {
              pts += 3;
              memoryDB.users[uId].pickemStats.correct++;
            }
          });

          // Rozliczanie 0-3
          const t03List = p.zeroThree?.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) || [];
          t03List.forEach(t => {
            memoryDB.users[uId].pickemStats.total++;
            if (off03.includes(t)) {
              pts += 3;
              memoryDB.users[uId].pickemStats.correct++;
            }
          });

          // Rozliczanie awansów
          const tAdvList = p.advancing?.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) || [];
          tAdvList.forEach(t => {
            memoryDB.users[uId].pickemStats.total++;
            if (offAdv.includes(t)) {
              pts += 1;
              memoryDB.users[uId].pickemStats.correct++;
            }
          });

          memoryDB.users[uId].points += pts;
        }

        await saveDB();
        return interaction.reply({ content: `Rozliczono Pick'Em dla ${stage} i zaktualizowano statystyki!` });
      }
      

      if (commandName === 'resetranking') {
        memoryDB.users = {};
        await saveDB();
        return interaction.reply({ content: 'Zresetowano ranking.', ephemeral: true });
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_match_menu') {
        const mId = interaction.values[0].replace('bet_match_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) return interaction.reply({ content: 'Mecz niedostępny.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_bet_${mId}`).setTitle(`Obstaw: ${match.details}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b_winner').setLabel(`Zwycięzca (${match.teamA}/${match.teamB})`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b_score').setLabel(`Wynik (${match.format})`).setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_bet_')) {
        const mId = interaction.customId.replace('modal_bet_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) return interaction.reply({ content: 'Mecz zablokowany.', ephemeral: true });
        const winner = interaction.fields.getTextInputValue('b_winner').trim();
        const score = interaction.fields.getTextInputValue('b_score').trim();
        if (!memoryDB.bets[interaction.user.id]) memoryDB.bets[interaction.user.id] = {};
        memoryDB.bets[interaction.user.id][mId] = { winner, score };
        await saveDB();
        return interaction.reply({ content: 'Zapisano typ!', ephemeral: true });
      }
              if (interaction.customId.startsWith('modal_pickem_')) {
          const stage = interaction.customId.split('_')[2];
          const t30 = interaction.fields.getTextInputValue('p_30').trim();
          const t03 = interaction.fields.getTextInputValue('p_03').trim();
          const tAdv = interaction.fields.getTextInputValue('p_adv').trim();

          // --- TUTAJ DODAJEMY WALIDACJĘ DUPLIKATÓW ---
          const t30List = t30.split(',').map(t => t.trim()).filter(Boolean);
          const t03List = t03.split(',').map(t => t.trim()).filter(Boolean);
          const tAdvList = tAdv.split(',').map(t => t.trim()).filter(Boolean);

          const allTeams = [...t30List, ...t03List, ...tAdvList];
          const lowerCaseTeams = allTeams.map(t => t.toLowerCase());
          const hasDuplicates = new Set(lowerCaseTeams).size !== lowerCaseTeams.length;

          if (hasDuplicates) {
            return interaction.reply({
              content: '❌ **Błąd w typowaniu!** Ta sama drużyna nie może się powtórzyć w różnych bilansach (np. w 3-0 i w awansujących). Sprawdź swoje wpisy!',
              ephemeral: true
            });
          }
          // ------------------------------------------

          if (!memoryDB.pickems.userPicks) memoryDB.pickems.userPicks = {};
          if (!memoryDB.pickems.userPicks[interaction.user.id]) memoryDB.pickems.userPicks[interaction.user.id] = {};
          
          memoryDB.pickems.userPicks[interaction.user.id][stage] = { 
            threeZero: t30, 
            zeroThree: t03, 
            advancing: tAdv 
          };
          
          await saveDB();
          return interaction.reply({ content: `Zapisano Pick'Em!`, ephemeral: true });
              }
      
    }
  } catch (err) {
    console.error('Błąd:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
    
