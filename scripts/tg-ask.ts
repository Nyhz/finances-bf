// Pregunta única al asesor para el comando /ask del bot de Telegram.
//
// One-shot deliberado: NO crea conversación, NO persiste transcript ni dispara
// extracción de memoria (a diferencia de /api/advisor/chat). Reúne el mismo
// contexto vivo (cartera + perfil + digest) y hace una sola pasada con
// runAdvisorOnce. Sin historial → no hay forma de seguir el hilo.
//
//   pnpm tsx scripts/tg-ask.ts "¿pregunta del Commander?"
//
// Auth: usa CLAUDE_CODE_OAUTH_TOKEN (crédito de la suscripción). Si
// ANTHROPIC_API_KEY está en el entorno, el cliente del asesor se niega a correr.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local opcional.
}

import { runAdvisorOnce } from "../src/lib/advisor/client";
import { buildChatPrompt, buildChatSystemPrompt } from "../src/lib/advisor/prompts";
import {
  getAdvisorContext,
  readDigestForPrompt,
  readProfileForPrompt,
} from "../src/server/advisor";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error("Uso: tsx scripts/tg-ask.ts \"<pregunta>\"");
    process.exit(2);
  }

  const portfolio = await getAdvisorContext();
  const systemPrompt = buildChatSystemPrompt({
    portfolio,
    profile: readProfileForPrompt(),
    digest: readDigestForPrompt(),
    // Sin resúmenes de chats previos: el comando es one-shot y apátrida.
    summaries: "",
  });
  // Historial vacío — una sola pregunta, una sola respuesta.
  const prompt = buildChatPrompt([], question);
  const model = process.env.ADVISOR_CHAT_MODEL ?? "claude-opus-4-8";

  const { text } = await runAdvisorOnce({
    model,
    systemPrompt,
    prompt,
    allowedTools: ["WebSearch", "WebFetch"],
    maxTurns: 8,
  });

  console.log(text.trim() || "(el asesor no devolvió texto)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
