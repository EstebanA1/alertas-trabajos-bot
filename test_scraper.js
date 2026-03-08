require('dotenv').config();
const { addJob, isJobSeen } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');

async function runOnce() {
    console.log("🧪 [TEST] Ejecutando prueba única del scraper de Telegram...\n");

    const jobs = await scrapeTelegramChannel();

    console.log(`\n📋 Mensajes que pasaron el filtro de tiempo: ${jobs.length}`);
    jobs.forEach(j => console.log(`  - [${j.id}] ${j.title.substring(0, 50)}`));

    let nuevas = 0;
    for (const job of jobs) {
        if (await addJob(job.id)) {
            nuevas++;
            console.log(`\n📤 Enviando alerta para: ${job.id}`);
            await enviarAlerta(job);
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            console.log(`⏭️  Ya visto antes, saltando: ${job.id}`);
        }
    }

    console.log(`\n✅ Test finalizado. ${nuevas} alertas nuevas enviadas.`);
    process.exit(0); // Termina el proceso limpiamente
}

runOnce();
