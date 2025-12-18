# TableMonkey

TableMonkey is a web application that reads CSV files, loads them into a SQLite database (using SQL.js), and allows you to interact with the data using natural language commands via a local LLM (Ollama).

## Features

- Load CSV files into SQLite database
- Natural language to SQL conversion using Ollama LLM
- Direct table operations (delete, save)
- Record management (add, edit, delete)
- Command history via commands.txt
- Comprehensive logging

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create configuration files:

   - `config-llm.txt` - LLM configuration (in the root directory):
     ```
     address: localhost
     port: 11434
     model: llama2
     ```
   
   - `data/config-data.txt` - List of CSV files to load (one per line, in the data directory):
     ```
     example.csv
     ```

3. Create a `data` directory and place your CSV files there. CSV files should have the first line as schema:
   ```
   columnName1:TEXT,columnName2:INTEGER,columnName3:REAL
   data1,123,45.6
   data2,456,78.9
   ```

4. Start Ollama and ensure your model is available:
```bash
ollama serve
```

5. Start the application:
```bash
npm run dev
```

This will start both the API server (port 3000) and the Vite dev server (port 5173) concurrently. The application will be available at http://localhost:5173 with hot reload capabilities.

## Usage

- **Natural Language Commands**: Enter commands in the command input field and click "Execute". The LLM will generate SQL which is then executed.
- **Save Command**: After a successful command, click "Save" to append the command and SQL to commands.txt
- **Direct Commands**: Use the dropdown to delete or save tables
- **Record Operations**: Select a row and use Add/Edit/Delete buttons
- **Restart**: Click the Restart button to reset everything

## Commands.txt Format

Commands can be stored in `data/commands.txt`:
- Plain text commands (will be sent to LLM)
- Special commands starting with `!`:
  - `!REM ...` - Remark (no action)
  - `!SAVE tablename` - Save table to CSV
- SQL in brackets `[SQL here]` - Pre-generated SQL (skips LLM call)

Example:
```
show all records
[SELECT * FROM example]
add a new record with name "test"
[INSERT INTO example (name) VALUES ('test')]
```

