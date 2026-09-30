const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const http = require('http');

// --- MINI SERWER HTTP DLA UPTIMEROBOTA ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord dziala 24/7!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Mini serwer HTTP dziala na porcie ${PORT}`);
});
// ----------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = '!';
const DB_FILE = './database.json';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { matches: {}, users: {}, settings: { locked: false, lockTime: null }, nextMatchId: 1 };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.settings) data.settings = { locked: false, lockTime: null };
    if (!data.nextMatchId) data.nextMatchId = 1;
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Mechanizm sprawdzający automatyczne zamykanie co 60 sekund
setInterval(() => {
    const db = loadDB();
    let modified = false;
    const now = new Date();

    if (!db.settings.locked && db.settings.lockTime) {
        const targetTime = new Date(db.settings.lockTime);
        if (now >= targetTime) {
            db.settings.locked = true;
            db.settings.lockTime = null;
            modified = true;
            
            client.guilds.cache.forEach(guild => {
                const channel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                if (channel) {
                    channel.send('🔒 **Automatyczne zamknięcie (globalne):** Czas minął! Wszystkie typy zostały zablokowane.');
                }
            });
        }
    }

    for (const mId in db.matches) {
        const match = db.matches[mId];
        if (!match.locked && match.lockTime) {
            const matchTargetTime = new Date(match.lockTime);
            if (now >= matchTargetTime) {
                match.locked = true;
                match.lockTime = null;
                modified = true;

                client.guilds.cache.forEach(guild => {
                    const channel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                    if (channel) {
                        channel.send(`🔒 **Automatyczne zamknięcie:** Czas na typowanie meczu **ID ${mId}** (${match.details}) minął! Mecz został zablokowany.`);
                    }
                });
            }
        }
    }

    if (modified) {
        saveDB(db);
    }
}, 60000);

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}! Bot w chmurze działa.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const db = loadDB();

    // --- KOMENDA POMOCY ---
    if (command === 'komendy' || command === 'pomoc') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Lista komend bota e-sportowego')
            .setColor(0x0099FF)
            .addFields(
                { 
                    name: '🎮 Komendy dla graczy', 
                    value: 
                        '`!mecze` - Wyświetla listę aktywnych meczów, ich ID i terminy zamknięcia\n' +
                        '`!typ [ID] [Twój typ]` - Obstawiasz wynik konkretnego meczu\n' +
                        '`!mojetypy` - Pokazuje Twoje aktualne typy\n' +
                        '`!profil` (lub `!statystyki`) - Wyświetla Twój profil gracza, punkty i statystyki trafień\n' +
                        '`!historia` - Sprawdza Twoją pełną historię typów\n' +
                        '`!prywatnykanal` - Tworzy Twój osobisty, prywatny wątek na serwerze'
                },
                { 
                    name: '🛡️ Komendy dla administratora', 
                    value: 
                        '`!dodajmecz [Nazwa]` - Automatycznie dodaje kolejny mecz (np. 1, 2, 3...)\n' +
                        '`!edytujmecz [ID] [Nowa nazwa]` - Zmienia nazwę meczu\n' +
                        '`!usunmecz [ID]` - Usuwa wskazany mecz\n' +
                        '`!zamknij` - Ręcznie blokuje typowanie globalnie\n' +
                        '`!otworz` - Ręcznie odblokowuje typowanie globalnie\n' +
                        '`!zamknijok [HH:MM]` - Ustawia globalne zamknięcie o wybranej godzinie\n' +
                        '`!zamknijmecz [ID] [HH:MM]` LUB `[RRRR-MM-DD HH:MM]` - Ustawia automatyczne zamknięcie dla konkretnego meczu\n' +
                        '`!rozlicz [ID] [Wynik]` - Rozlicza mecz i przyznaje punkty oraz statystyki\n' +
                        '`!ranking` (lub `!punkty`) - Wyświetla tabelę najlepszych graczy\n' +
                        '`!resetranking` - Resetuje ranking, punkty i numerację meczów do 1'
                }
            );
        return message.reply({ embeds: [embed] });
    }

    // --- KOMENDY ADMINISTRATORA ---
    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchDetails = args.join(' ');
        if (!matchDetails) return message.reply('❌ Użycie: `!dodajmecz [Nazwa meczu]`');
        
        const matchId = db.nextMatchId.toString();
        db.nextMatchId++;

        db.matches[matchId] = { 
            details: matchDetails, 
            locked: false, 
            lockTime: null 
        };
        saveDB(db);
        return message.reply(`✅ Dodano mecz z automatycznym **ID: ${matchId}** (${matchDetails}).`);
    }

    if (command === 'edytujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const newDetails = args.slice(1).join(' ');
        if (!matchId || !newDetails) return message.reply('❌ Użycie: `!edytujmecz [ID] [Nowa nazwa]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');
        
        db.matches[matchId].details = newDetails;
        saveDB(db);
        return message.reply(`✅ Zaktualizowano mecz **ID: ${matchId}** na: *${newDetails}*`);
    }

    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId) return message.reply('❌ Użycie: `!usunmecz [ID]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');

        delete db.matches[matchId];
        saveDB(db);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = true;
        db.settings.lockTime = null;
        saveDB(db);
        return message.reply('🔒 Typowanie globalne zostało **zamknięte**.');
    }
    
    if (command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = false;
        db.settings.lockTime = null;
        saveDB(db);
        return message.reply('🔓 Typowanie globalne zostało **otwarte**.');
    }

    if (command === 'zamknijok') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const timeArg = args.join(' ');
        if (!timeArg) return message.reply('❌ Użycie: `!zamknijok [HH:MM]`');

        let targetDate;
        if (timeArg.includes('-')) {
            targetDate = new Date(timeArg);
        } else {
            const now = new Date();
            const [hours, minutes] = timeArg.split(':');
            if (!hours || !minutes) return message.reply('❌ Błędny format godziny! Użyj `HH:MM`');
            now.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            targetDate = now;
        }

        if (isNaN(targetDate.getTime())) return message.reply('❌ Nieprawidłowy format czasu!');

        db.settings.lockTime = targetDate.toISOString();
        db.settings.locked = false;
        saveDB(db);
        
        return message.reply(`⏰ Zaplanowano globalne zamknięcie typowania na: **${targetDate.toLocaleString('pl-PL')}**`);
    }

    if (command === 'zamknijmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const restArgs = args.slice(1);
        if (!matchId || restArgs.length === 0) return message.reply('❌ Użycie: `!zamknijmecz [ID] [HH:MM]` lub `!zamknijmecz [ID] [RRRR-MM-DD HH:MM]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');

        let targetDate;
        if (restArgs.length >= 2 && restArgs[0].includes('-')) {
            const dateTimeString = `${restArgs[0]}T${restArgs[1]}:00`;
            targetDate = new Date(dateTimeString);
        } else {
            const timeArg = restArgs.join(' ');
            const [hours, minutes] = timeArg.split(':');
            if (!hours || !minutes) return message.reply('❌ Błędny format! Użyj `HH:MM` lub `RRRR-MM-DD HH:MM`');
            
            targetDate = new Date();
            targetDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        }

        if (isNaN(targetDate.getTime())) return message.reply('❌ Nieprawidłowy format daty lub czasu!');

        db.matches[matchId].lockTime = targetDate.toISOString();
        db.matches[matchId].locked = false;
        saveDB(db);

        return message.reply(`⏰ Mecz **ID ${matchId}** (${db.matches[matchId].details}) zamknie się automatycznie: **${targetDate.toLocaleString('pl-PL')}**`);
    }

    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.users = {};
        db.matches = {};
        db.nextMatchId = 1;
        db.settings.locked = false;
        db.settings.lockTime = null;
        saveDB(db);
        return message.reply('🔄 Ranking, historia typów, aktywne mecze zostały wyczyszczone, a licznik ID zresetowany do **1**.');
    }

    if (command === 'ranking' || command === 'punkty') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');

        const sorted = Object.entries(db.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return message.reply('🏆 Tabela rankingowa jest pusta.');
        let desc = '';
        sorted.forEach(([id, data], i) => {
            let m = `${i+1}.`;
            if (i === 0) m = '🥇'; if (i === 1) m = '🥈'; if (i === 2) m = '🥉';
            desc += `${m} <@${id}> — **${data.points || 0} pkt**\n`;
        });
        const embed = new EmbedBuilder().setTitle('🏆 Tabela Wyników').setDescription(desc).setColor(0xFFD700);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'rozlicz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const matchResultFull = args.slice(1).join(' ').toLowerCase(); 
        
        if (!matchId || !matchResultFull) return message.reply('❌ Użycie: `!rozlicz [ID] [Wynik]` (np. `!rozlicz 1 FaZe 2-1 MOUZ` lub `!rozlicz 1 2-1`)');

        let resultsSummary = `⚔️ **Rozliczenie meczu ID: ${matchId}**\n🏆 Wynik: **${args.slice(1).join(' ')}**\n\n`;
        let count = 0;

        for (const userId in db.users) {
            const user = db.users[userId];
            const p = user.predictions[matchId];
            if (!p) continue;
            count++;
            
            if (user.points === undefined) user.points = 0;
            if (user.exactHits === undefined) user.exactHits = 0;
            if (user.winnerHits === undefined) user.winnerHits = 0;
            if (user.settledCount === undefined) user.settledCount = 0;

            user.settledCount += 1;

            const cleanP = p.toLowerCase().trim();

            // Dopasowanie: jeśli wpisany wynik admina zawiera typ gracza lub na odwrót
            if (cleanP === matchResultFull || matchResultFull.includes(cleanP) || cleanP.includes(matchResultFull)) {
                if (cleanP.includes('-') || cleanP.includes(':') || matchResultFull.includes('-') || matchResultFull.includes(':')) {
                    user.points += 3;
                    user.exactHits += 1;
                    resultsSummary += `🎯 <@${userId}> trafił **dokładny wynik** (${p})! **+3 pkt**\n`;
                } else {
                    user.points += 1;
                    user.winnerHits += 1;
                    resultsSummary += `✅ <@${userId}> trafił zwycięzcę (${p})! **+1 pkt**\n`;
                }
            } else {
                resultsSummary += `❌ <@${userId}> pomylił się (${p}). 0 pkt\n`;
            }
        }
        saveDB(db);
        if (count === 0) return message.reply(`⚠️ Żaden użytkownik nie obstawił meczu ID ${matchId}.`);
        return message.channel.send(resultsSummary);
    }

    // --- KOMENDY DLA GRACZY ---
    if (command === 'mecze') {
        const matchKeys = Object.keys(db.matches);
        if (matchKeys.length === 0) return message.reply('📌 Brak aktywnych meczów.');
        let desc = '';
        for (const mId of matchKeys) {
            const m = db.matches[mId];
            let statusText = '🟢 Otwarte';
            if (m.locked) {
                statusText = '🔒 Zamknięte';
            } else if (m.lockTime) {
                const lockDateStr = new Date(m.lockTime).toLocaleString('pl-PL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                statusText = `⏰ Zamyka się: ${lockDateStr}`;
            }
            desc += `• **ID ${mId}**: ${m.details} — *${statusText}*\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie globalne jest aktualnie zablokowane przez administratora!');
        
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        if (!matchId || !pred) return message.reply('❌ Użycie: `!typ [ID_meczu] [Twój typ]`');
        
        const match = db.matches[matchId];
        if (!match) return message.reply('❌ Taki mecz nie istnieje!');
        if (match.locked) return message.reply(`❌ Typowanie dla meczu **ID ${matchId}** zostało już zamknięte!`);

        const userId = message.author.id;
        if (!db.users[userId]) db.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        db.users[userId].predictions[matchId] = pred;
        saveDB(db);
        return message.reply(`✅ <@${userId}>, zapisano typ: **${pred}** dla meczu ID **${matchId}**.`);
    }

    if (command === 'profil' || command === 'statystyki') {
        const userId = message.author.id;
        const userData = db.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        const points = userData.points || 0;
        const exactHits = userData.exactHits || 0;
        const winnerHits = userData.winnerHits || 0;
        const settledCount = userData.settledCount || 0;
        const totalPreds = userData.predictions ? Object.keys(userData.predictions).length : 0;

        let winRate = 0;
        if (settledCount > 0) {
            winRate = Math.round(((exactHits + winnerHits) / settledCount) * 100);
        }

        const sortedUsers = Object.entries(db.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
        const userRankIndex = sortedUsers.findIndex(([id]) => id === userId);
        const rankText = userRankIndex !== -1 ? `#${userRankIndex + 1}` : 'Poza rankingiem';

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profil gracza: ${message.author.username}`)
            .setColor(0x00FFCC)
            .addFields(
                { name: '🏆 Punkty', value: `**${points} pkt** (Miejsce: ${rankText})`, inline: true },
                { name: '🎯 Złote strzały (3 pkt)', value: `**${exactHits}**`, inline: true },
                { name: '✅ Trafieni zwycięzcy (1 pkt)', value: `**${winnerHits}**`, inline: true },
                { name: '📈 Skuteczność', value: `**${winRate}%** (z ${settledCount} rozliczonych)`, inline: true },
                { name: '📌 Liczba obstawionych typów', value: `**${totalPreds}**`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL());

        return message.reply({ embeds: [embed] });
    }

    if (command === 'mojetypy') {
        const userData = db.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📌 Brak zapisanych typów.');
        let desc = '';
        for (const mId in userData.predictions) {
            const matchName = db.matches[mId] ? db.matches[mId].details : 'Mecz usunięty';
            desc += `• **[ID ${mId}]** ${matchName} ➔ **${userData.predictions[mId]}**\n`;
        }
        const embed = new EmbedBuilder().setTitle('Twoje typy').setDescription(desc).setColor(0x00AE86);
        return message.reply({ embeds: [embed], flags: 64 });
    }

    if (command === 'historia') {
        const userData = db.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📜 Nie masz jeszcze żadnej historii typów.');
        
        let desc = `Masz aktualnie **${userData.points || 0} pkt**.\n\n**Twoje dotychczasowe typy:**\n`;
        for (const mId in userData.predictions) {
            const matchName = db.matches[mId] ? db.matches[mId].details : 'Mecz zakończony/usunięty';
            desc += `• Mecz ID **${mId}** (${matchName}): ` + `\`${userData.predictions[mId]}\`\n`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📜 Twoja historia typów')
            .setDescription(desc)
            .setColor(0x9B59B6);
            
        return message.reply({ embeds: [embed], flags: 64 });
    }

    if (command === 'prywatnykanal') {
        try {
            if (!message.channel.isTextBased() || message.channel.isDMBased()) {
                return message.reply('❌ Tej komendy można użyć tylko na zwykłym kanale tekstowym serwera.');
            }

            const thread = await message.channel.threads.create({
                name: `typy-${message.author.username}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: `Prywatny kanał do typowania dla użytkownika ${message.author.tag}`
            });

            await thread.members.add(message.author.id);

            return message.reply(`✅ Utworzyłem dla Ciebie prywatny wątek: <#${thread.id}>. Tylko Ty i administracja macie do niego wgląd!`);
        } catch (error) 
