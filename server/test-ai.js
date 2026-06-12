// Banco de pruebas del agente AI
// Ejecutar: node test-ai.js

const BASE = 'http://localhost:4000';

const questions = [
  '¿Cuántas tareas tengo pendientes hoy?',
  '¿Qué proyectos tengo?',
  '¿Cuántas horas llevo este mes?',
  '¿Tengo tareas vencidas?',
  '¿Qué reuniones tengo esta semana?',
  '¿Hay algún festivo próximo?',
  'Dime un resumen de mi semana',
];

async function testContext() {
  console.log('=== TEST 1: Contexto (buildCompactContext) ===');
  try {
    const res = await fetch(`${BASE}/api/ai/snapshot`, { method: 'POST' });
    const data = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  Snapshot date: ${data.date || 'N/A'}`);
    console.log(`  OK: ${res.ok ? 'SÍ' : 'NO'}`);
    if (data.error) console.log(`  Error: ${data.error}`);
  } catch (err) {
    console.log(`  FALLO de conexión: ${err.message}`);
  }
  console.log('');
}

async function testLMStudio() {
  console.log('=== TEST 2: Conexión directa LM Studio ===');
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/models');
    const data = await res.json();
    const models = data.data?.map(m => m.id) || [];
    console.log(`  Status: ${res.status}`);
    console.log(`  Modelos: ${models.join(', ')}`);
    console.log(`  OK: SÍ`);
  } catch (err) {
    console.log(`  FALLO: ${err.message}`);
  }
  console.log('');
}

async function testChat(question, index) {
  const label = `TEST ${index + 3}: "${question}"`;
  console.log(`=== ${label} ===`);
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question }),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const data = await res.json();

    if (res.ok) {
      const reply = data.reply || '';
      const preview = reply.length > 150 ? reply.slice(0, 150) + '...' : reply;
      console.log(`  Status: ${res.status} | Tiempo: ${elapsed}s | ConvID: ${data.conversation_id}`);
      console.log(`  Respuesta: ${preview}`);
      console.log(`  OK: SÍ`);
    } else {
      console.log(`  Status: ${res.status} | Tiempo: ${elapsed}s`);
      console.log(`  Error: ${data.error}`);
      console.log(`  OK: NO`);
    }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  FALLO (${elapsed}s): ${err.message}`);
    console.log(`  OK: NO`);
  }
  console.log('');
}

async function testConversations() {
  console.log('=== TEST FINAL: Historial de conversaciones ===');
  try {
    const res = await fetch(`${BASE}/api/ai/conversations`);
    const data = await res.json();
    console.log(`  Conversaciones totales: ${data.length}`);
    data.slice(0, 5).forEach(c => {
      console.log(`    #${c.id} "${c.title}" (${c.updated_at})`);
    });
    console.log(`  OK: SÍ`);
  } catch (err) {
    console.log(`  FALLO: ${err.message}`);
  }
  console.log('');
}

async function run() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   BANCO DE PRUEBAS - AGENTE AI RAG      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log('');

  // Tests rápidos
  await testContext();
  await testLMStudio();

  // Tests de chat (secuenciales, uno a uno)
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < questions.length; i++) {
    try {
      const start = Date.now();
      const res = await fetch(`${BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: questions[i] }),
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const data = await res.json();

      const ok = res.ok && data.reply && !data.error;
      const preview = (data.reply || data.error || 'sin respuesta').slice(0, 120);
      console.log(`[${ok ? 'PASS' : 'FAIL'}] (${elapsed}s) Q: "${questions[i]}"`);
      console.log(`        A: ${preview}${(data.reply || '').length > 120 ? '...' : ''}`);
      if (ok) passed++; else failed++;
    } catch (err) {
      console.log(`[FAIL] Q: "${questions[i]}" → ${err.message}`);
      failed++;
    }
    console.log('');
  }

  await testConversations();

  console.log('═══════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passed, ${failed} failed de ${questions.length} tests`);
  console.log('═══════════════════════════════════════════');
}

run().catch(e => { console.error('Error fatal:', e); process.exit(1); });
