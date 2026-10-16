const { SlashCommandBuilder } = require('discord.js');

const slashCommands = [
  new SlashCommandBuilder().setName('mecze').setDescription('Wyświetla listę meczów do typowania'),
  new SlashCommandBuilder().setName('moje_typy').setDescription('Wyświetla Twoje typy na mecze'),
  new SlashCommandBuilder().setName('profil').setDescription('Twój profil'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking'),
  new SlashCommandBuilder()
    .setName('pickem')
    .setDescription('Wybierz swoje typy Pick\'Em na dany stage')
    .addStringOption(opt => opt.setName('stage').setDescription('Wybierz stage').setRequired(true)
      .addChoices(
        { name: 'Stage 1 (Opening)', value: 'stage1' },
        { name: 'Stage 2 (Elimination)', value: 'stage2' },
        { name: 'Stage 3 (Playoffs)', value: 'stage3' }
      )),
  new SlashCommandBuilder().setName('moje_pickemy').setDescription('Wyświetla Twoje zapisane Pick\'Emy i MVP'),
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
    .addSubcommand(sub =>
      sub.setName('rozlicz_mecz')
        .setDescription('Rozlicz wynik meczu')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
        .addStringOption(opt => opt.setName('zwyciezca').setDescription('Nazwa wygranej drużyny').setRequired(true))
        .addStringOption(opt => opt.setName('wynik').setDescription('Dokładny wynik (np. 13-8 lub 2-1)').setRequired(true))
        .addStringOption(opt => opt.setName('mvp_mecz').setDescription('Oficjalny MVP meczu (opcjonalnie)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_setup')
        .setDescription('Konfiguruj drużyny dla stage\'u Pick\'Em')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addStringOption(opt => opt.setName('druzyny').setDescription('Lista drużyn oddzielona przecinkami').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_lock')
        .setDescription('Zablokuj/odblokuj Pick\'Em dla stage\'u')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addBooleanOption(opt => opt.setName('status').setDescription('True = zablokuj, False = odblokuj').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_rozlicz')
        .setDescription('Rozlicz punkty Pick\'Em dla danego stage\'u')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addStringOption(opt => opt.setName('oficjalne_30').setDescription('Oficjalne 3-0 (po przecinku)').setRequired(true))
        .addStringOption(opt => opt.setName('oficjalne_03').setDescription('Oficjalne 0-3 (po przecinku)').setRequired(true))
        .addStringOption(opt => opt.setName('oficjalne_adv').setDescription('Oficjalnie awansujące (po przecinku)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_rozlicz_mvp')
        .setDescription('Rozlicz punkty za wytypowanie MVP (3 pkt)')
        .addStringOption(opt => opt.setName('gracz_mvp').setDescription('Nick oficjalnego MVP Turnieju').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset_ranking')
        .setDescription('⚠️ Resetuje punkty i statystyki WSZYSTKICH graczy do zera')
    )
].map(cmd => cmd.toJSON());

module.exports = slashCommands;
                   
