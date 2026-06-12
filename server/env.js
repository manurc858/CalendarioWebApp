// Carga server/.env si existe. Debe ser el PRIMER import de index.js
// para que DATABASE_URL esté disponible cuando db.js se inicialice.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // sin .env: se usan las variables de entorno del sistema (p. ej. en Render)
}
