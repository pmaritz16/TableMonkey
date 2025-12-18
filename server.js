import express from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Serve static files from dist if it exists
if (existsSync(join(__dirname, 'dist'))) {
  app.use(express.static('dist'))
} else {
  // In development, serve a simple redirect or message
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>TableMonkey</title></head>
        <body>
          <h1>TableMonkey API Server</h1>
          <p>Please run <code>npm run dev:vite</code> in another terminal for the UI, or build with <code>npm run build</code></p>
          <p>API is available at <a href="/api">/api</a></p>
        </body>
      </html>
    `)
  })
}

const DATA_DIR = join(__dirname, 'data')
const CONFIG_LLM = join(__dirname, 'config-llm.txt')
const CONFIG_DATA = join(DATA_DIR, 'config-data.txt')
const COMMANDS_FILE = join(DATA_DIR, 'commands.txt')
const LOG_FILE = join(__dirname, 'main.log')

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// Initialize log file
if (existsSync(LOG_FILE)) {
  unlinkSync(LOG_FILE)
}
writeFileSync(LOG_FILE, `[${new Date().toISOString()}] TableMonkey started\n`, 'utf-8')

function log(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${message}`
  console.log(logMessage)
  try {
    writeFileSync(LOG_FILE, logMessage + '\n', { flag: 'a' })
  } catch (err) {
    console.error('Failed to write to log:', err)
  }
}

// API Routes
app.get('/api/config-llm.txt', (req, res) => {
  if (!existsSync(CONFIG_LLM)) {
    return res.status(404).send('config-llm.txt not found')
  }
  res.sendFile(CONFIG_LLM)
})

app.get('/api/config-data.txt', (req, res) => {
  if (!existsSync(CONFIG_DATA)) {
    return res.status(404).send('config-data.txt not found')
  }
  res.sendFile(CONFIG_DATA)
})

app.get('/api/macros.txt', (req, res) => {
  const macrosFile = join(DATA_DIR, 'macros.txt')
  if (!existsSync(macrosFile)) {
    return res.status(404).send('macros.txt not found')
  }
  res.sendFile(macrosFile)
})

app.get('/api/data/:filename', (req, res) => {
  const filePath = join(DATA_DIR, req.params.filename)
  if (!existsSync(filePath)) {
    return res.status(404).send('File not found')
  }
  res.sendFile(filePath)
})

app.post('/api/log', (req, res) => {
  log(req.body.message)
  res.json({ success: true })
})

app.get('/api/commands.txt', (req, res) => {
  if (!existsSync(COMMANDS_FILE)) {
    return res.send('')
  }
  res.sendFile(COMMANDS_FILE)
})

app.post('/api/commands.txt', (req, res) => {
  try {
    const { plainText, sql } = req.body
    let content = existsSync(COMMANDS_FILE) ? readFileSync(COMMANDS_FILE, 'utf-8') : ''
    if (content && !content.endsWith('\n')) {
      content += '\n'
    }
    content += plainText + '\n[' + sql + ']\n'
    writeFileSync(COMMANDS_FILE, content, 'utf-8')
    log(`Appended to commands.txt`)
    res.json({ success: true })
  } catch (err) {
    log(`Error appending to commands.txt: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/save-csv', (req, res) => {
  try {
    const { tableName, csvContent } = req.body
    
    if (!tableName) {
      return res.status(400).json({ error: 'Table name is required' })
    }
    
    if (!csvContent) {
      return res.status(400).json({ error: 'CSV content is required' })
    }
    
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
      log(`Created data directory: ${DATA_DIR}`)
    }
    
    const filePath = join(DATA_DIR, `${tableName}.csv`)
    log(`Saving CSV to: ${filePath}`)
    
    writeFileSync(filePath, csvContent, 'utf-8')
    log(`Saved table ${tableName} to CSV`)
    res.json({ success: true })
  } catch (err) {
    log(`Error saving CSV: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/process-commands', async (req, res) => {
  try {
    if (!existsSync(COMMANDS_FILE)) {
      return res.json({ success: true, message: 'No commands.txt file' })
    }
    
    const content = readFileSync(COMMANDS_FILE, 'utf-8')
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)
    
    log(`Processing ${lines.length} commands from commands.txt`)
    
    // Return the commands for the client to process
    res.json({ success: true, commands: lines })
  } catch (err) {
    log(`Error reading commands.txt: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/update-commands', (req, res) => {
  try {
    const { content } = req.body
    writeFileSync(COMMANDS_FILE, content, 'utf-8')
    log(`Updated commands.txt`)
    res.json({ success: true })
  } catch (err) {
    log(`Error updating commands.txt: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`)
})

