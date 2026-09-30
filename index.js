const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');

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
        const initialData = { matches: {}, users: {}, settings: { locked: false, lockTime: null } };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.settings) data.settings = { locked: false, lockTime: null };
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Mechanizm sprawdzający automatyczne zamykanie co 60 sekund
setInterval(() => {
    const db = loadDB();
    if (!db.settings.locked && db.settings.lockTime) {
        const now = new Date();
        const targetTime = new Date(db.settings.lockTime);
        if (now >= targetTime) {
            db.settings.locked = true;
            db.settings.lockTime = null; // Resetujemy czas po zamknięciu
            saveDB(db);
            
            // Wysyłamy informację na pierwszy dostępny kanał tekstowy, gdzie bot ma uprawnienia
            client.guilds.cache.forEach(guild => {
                const channel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                if (channel) {
                    channel.send('🔒 **Automatyczne zamknięcie:** Czas na typowanie minął! Typy zostały zablokowane.');
                }
            });
        }
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
                        '`!mecze` - Wyświetla listę aktywnych meczów i ich ID\n' +
                        '`!typ [ID] [Twój typ]` - Obstawiasz wynik meczu (możesz nadpisać)\n' +
                        '`!mojetypy` - Pokazuje Twoje aktualne typy\n' +
                        '`!historia` - Sprawdza Twoje punkty i całą historię typów\n' +
                        '`!prywatnykanal` - Tworzy Twój osobisty, prywatny wątek na serwerze'
                },
                { 
                    name: '🛡️️ Komendy dla administratora', 
                    value: 
                        '`!dodajmecz [ID] [Nazwa]` - Dodaje nowy mecz\n' +
                        '`!edytujmecz [ID] [Nowa nazwa]` - Zmienia nazwę meczu\n' +
                        '`!usunmecz [ID]` - Usuwa wskazany mecz\n' +
                        '`!zamknij` - Ręcznie blokuje typowanie\n' +
                        '`!otworz` - Ręcznie odblokowuje typowanie\n' +
                        '`!zamknijok [HH:MM]` - Ustawia automatyczne zamknięcie o wybranej godzinie\n' +
                        '`!rozlicz [ID] [Zwycięzca] [Wynik]` - Rozlicza mecz i przyznaje punkty\n' +
                        '`!ranking` (lub `!punkty`) - Wyświetla tabelę najlepszych graczy (Tylko Admin)\n' +
                        '`!resetranking` - Resetuje ranking i punkty wszystkich graczy'
                }
            );
        return message.reply({ embeds: [embed] });
    }

    // --- KOMENDY ADMINISTRATORA ---

    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const matchDetails = args.slice(1).join(' ');
        if (!matchId || !matchDetails) return message.reply('❌ Użycie: `!dodajmecz [ID] [Nazwa]`');
        db.matches[matchId] = { details: matchDetails };
        saveDB(db);
        return message.reply(`✅ Dodano mecz **ID: ${matchId}** (${matchDetails}).`);
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
        db.settings.lockTime = null; // Anulujemy też ewentualny automatyczny timer
        saveDB(db);
        return message.reply('🔒 Typowanie zostało **zamknięte**.');
    }
    
    if (command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = false;
        db.settings.lockTime = null;
        saveDB(db);
        return message.reply('🔓 Typowanie zostało **otwarte**.');
    }

    if (command === 'zamknijok') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const timeArg = args.join(' ');
        if (!timeArg) return message.reply('❌ Użycie: `!zamknijok [HH:MM]` (np. `!zamknijok 19:30`) lub z datą `!zamknijok 2026-09-28 19:30`');

        let targetDate;
        if (timeArg.includes('-')) {
            targetDate = new Date(timeArg);
        } else {
            // Jeśli podano samą godzinę (np. 19:30), ustawiamy na dzisiejszy dzień
            const now = new Date();
            const [hours, minutes] = timeArg.split(':');
            if (!hours || !minutes) return message.reply('❌ Błędny format godziny! Użyj `HH:MM`');
            now.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            targetDate = now;
        }

        if (isNaN(targetDate.getTime())) return message.reply('❌ Nieprawidłowy format czasu!');

        db.settings.lockTime = targetDate.toISOString();
        db.settings.locked = false; // Otwieramy na czas oczekiwania
        saveDB(db);
        
        return message.reply(`⏰ Zaplanowano automatyczne zamknięcie typowania na: **${targetDate.toLocaleString('pl-PL')}**`);
    }

    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.users = {};
        saveDB(db);
        return message.reply('🔄 Ranking oraz historia typów wszystkich graczy zostały zresetowane.');
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
        const winner = args[1];
        const exactScore = args.slice(2).join(' ');
        if (!matchId || !winner || !exactScore) return message.reply('❌ Użycie: `!rozlicz [ID] [Zwycięzca] [Dokładny Wynik]`');

        let resultsSummary = `⚔️ **Rozliczenie meczu ID: ${matchId}**\n🏆 Wynik: **${winner} ${exactScore}**\n\n`;
        let count = 0;

        for (const userId in db.users) {
            const p = db.users[userId].predictions[matchId];
            if (!p) continue;
            count++;
            if (!db.users[userId].points) db.users[userId].points = 0;

            if (p.toLowerCase() === `${winner} ${exactScore}`.toLowerCase()) {
                db.users[userId].points += 3;
                resultsSummary += `🎯 <@${userId}> trafił **dokładny wynik** (${p})! **+3 pkt**\n`;
            } else if (p.toLowerCase().includes(winner.toLowerCase())) {
                db.users[userId].points += 1;
                resultsSummary += `✅ <@${userId}> trafił zwycięzcę (${p})! **+1 pkt**\n`;
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
            desc += `• **ID ${mId}**: ${db.matches[mId].details}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie jest aktualnie zablokowane przez administratora!');
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        if (!matchId || !pred) return message.reply('❌ Użycie: `!typ [ID_meczu] [Twój typ]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');

        const userId = message.author.id;
        if (!db.users[userId]) db.users[userId] = { predictions: {}, points: 0 };
        db.users[userId].predictions[matchId] = pred;
        saveDB(db);
        return message.reply(`✅ <@${userId}>, zapisano typ: **${pred}** dla meczu ID **${matchId}**.`);
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
        return message.reply({ embeds: [embed], ephemeral: true });
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
        } catch (error) {
            console.error('Błąd tworzenia wątku:', error);
            return message.reply('❌ Nie udało się utworzyć prywatnego wątku. Upewnij się, że bot ma uprawnienie do tworzenia prywatnych wątków.');
        }
    }
});

client.login(TOKEN);
        
