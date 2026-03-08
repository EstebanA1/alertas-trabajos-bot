const TOKEN = "8322025210:AAEghmGN3m3GJjnFik5lCfopscGHv6FaNaE";
const CHAT_ID = "5099535757";

async function enviarMensaje() {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  
  const mensaje = `
🚀 *¡Hola humano!* Soy tu bot de AlertasTrabajos.

Este es mi primer mensaje de prueba en caliente desde tu PC. Acabo de nacer y todo está configurado correctamente 💻🔥

_Preparado para buscarte empleo._
  `;

  const body = {
    chat_id: CHAT_ID,
    text: mensaje,
    parse_mode: "Markdown" // Permite poner negritas cursivas etc
  };

  try {
    console.log("⏳ Enviando mensaje a Telegram...");
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.ok) {
        console.log("✅ ¡Mensaje enviado exitosamente! Revisa tu celular.");
    } else {
        console.error("❌ Error enviando mensaje:", data.description);
    }
  } catch (error) {
    console.error("❌ Error de conexión:", error);
  }
}

enviarMensaje();
