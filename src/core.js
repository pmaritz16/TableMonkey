export class TableMonkeyCore {
  constructor(SQL) {
    this.SQL = SQL
    this.db = null
    this.llmConfig = null
    this.csvFiles = []
    this.macros = {}
  }

  async log(message) {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${message}`
    
    // Write to console
    console.log(logMessage)
    
    // Write to log file via API
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: logMessage })
      })
    } catch (err) {
      console.error('Failed to write to log file:', err)
    }
  }

  async initialize() {
    try {
      this.log('Initializing TableMonkey')
      
      // Read LLM config
      await this.loadLLMConfig()
      
      // Test LLM connection
      await this.testLLMConnection()
      
      // Read data config
      await this.loadDataConfig()
      
      // Load macros
      await this.loadMacros()
      
      // Initialize database
      this.db = new this.SQL.Database()
      this.log('Database initialized')
      
    } catch (err) {
      this.log(`Initialization error: ${err.message}`)
      throw err
    }
  }

  async loadLLMConfig() {
    const response = await fetch('/api/config-llm.txt')
    if (!response.ok) {
      throw new Error('config-llm.txt not found')
    }
    const configText = await response.text()
    this.parseLLMConfig(configText)
    this.log('LLM config loaded')
  }

  parseLLMConfig(configText) {
    const lines = configText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    this.llmConfig = {}
    
    for (const line of lines) {
      if (line.startsWith('address:')) {
        this.llmConfig.address = line.substring(8).trim()
      } else if (line.startsWith('port:')) {
        this.llmConfig.port = parseInt(line.substring(5).trim())
      } else if (line.startsWith('model:')) {
        this.llmConfig.model = line.substring(6).trim()
      }
    }
    
    if (!this.llmConfig.address || !this.llmConfig.port || !this.llmConfig.model) {
      throw new Error('Invalid LLM config: missing address, port, or model')
    }
  }

  async testLLMConnection() {
    this.log('Testing LLM connection...')
    
    try {
      const url = `http://${this.llmConfig.address}:${this.llmConfig.port}/api/generate`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.llmConfig.model,
          prompt: 'test',
          stream: false
        })
      })
      
      if (!response.ok) {
        throw new Error(`LLM connection failed: ${response.status} ${response.statusText}`)
      }
      
      this.log('LLM connection successful')
    } catch (err) {
      this.log(`LLM connection error: ${err.message}`)
      throw new Error(`Cannot connect to LLM at ${this.llmConfig.address}:${this.llmConfig.port}. Please check your configuration.`)
    }
  }

  async loadDataConfig() {
    const response = await fetch('/api/config-data.txt')
    if (!response.ok) {
      throw new Error('config-data.txt not found')
    }
    const configText = await response.text()
    
    this.csvFiles = configText.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    
    this.log(`Loaded ${this.csvFiles.length} CSV file paths`)
  }

  async loadMacros() {
    try {
      this.log('Reading macros.txt file')
      const response = await fetch('/api/macros.txt')
      if (!response.ok) {
        this.log('macros.txt file not found, no macros loaded')
        this.macros = {}
        return
      }
      
      const content = await response.text()
      const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      
      this.macros = {}
      for (const line of lines) {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) {
          this.log(`Invalid macro format (missing colon): ${line}`)
          continue
        }
        
        const macroName = line.substring(0, colonIndex).trim()
        const macroBody = line.substring(colonIndex + 1).trim()
        
        if (!macroName) {
          this.log(`Invalid macro format (empty name): ${line}`)
          continue
        }
        
        this.macros[macroName] = macroBody
        this.log(`Loaded macro: ${macroName}`)
      }
      
      const macroCount = Object.keys(this.macros).length
      this.log(`Successfully read macros.txt file: ${macroCount} macro(s) loaded`)
    } catch (err) {
      this.log(`Error reading macros.txt file: ${err.message}`)
      this.macros = {}
    }
  }

  expandMacro(commandText) {
    // Check if command starts with *
    if (!commandText.trim().startsWith('*')) {
      return { isMacro: false, expandedText: commandText }
    }
    
    // Parse macro invocation: *macroName param1 param2 ...
    const trimmed = commandText.trim()
    const parts = []
    let current = ''
    let inQuotes = false
    let quoteChar = null
    
    // Skip the leading *
    let i = 1
    while (i < trimmed.length && trimmed[i] === ' ') {
      i++
    }
    
    // Parse macro name and parameters
    while (i < trimmed.length) {
      const char = trimmed[i]
      
      if (char === '"' || char === "'") {
        if (!inQuotes) {
          // Opening quote
          inQuotes = true
          quoteChar = char
          i++
          continue
        } else if (char === quoteChar) {
          // Closing quote
          inQuotes = false
          quoteChar = null
          parts.push(current)
          current = ''
          i++
          // Skip spaces after closing quote
          while (i < trimmed.length && trimmed[i] === ' ') {
            i++
          }
          continue
        }
      }
      
      if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current)
          current = ''
        }
        i++
        continue
      }
      
      current += char
      i++
    }
    
    if (current) {
      parts.push(current)
    }
    
    if (parts.length === 0) {
      throw new Error('Invalid macro syntax: macro name required')
    }
    
    const macroName = parts[0]
    const parameters = parts.slice(1)
    
    // Check if macro exists
    if (!this.macros[macroName]) {
      throw new Error(`Macro "${macroName}" not found`)
    }
    
    // Get macro body
    let macroBody = this.macros[macroName]
    
    // Substitute parameters: __1, __2, etc.
    for (let paramIndex = 0; paramIndex < parameters.length; paramIndex++) {
      const paramNum = paramIndex + 1
      const paramValue = parameters[paramIndex]
      const placeholder = `__${paramNum}`
      
      // Replace all occurrences of __1, __2, etc.
      macroBody = macroBody.replace(new RegExp(`__${paramNum}`, 'g'), paramValue)
    }
    
    this.log(`Expanded macro ${macroName} with ${parameters.length} parameters`)
    return { isMacro: true, expandedText: macroBody }
  }

  async loadCSVFiles() {
    for (const fileName of this.csvFiles) {
      try {
        this.log(`Loading CSV: ${fileName}`)
        await this.loadCSVFile(fileName)
      } catch (err) {
        this.log(`Error loading CSV ${fileName}: ${err.message}`)
        throw new Error(`Failed to load CSV file: ${fileName} - ${err.message}`)
      }
    }
    this.log('All CSV files loaded successfully')
  }

  async loadCSVFile(fileName) {
    const response = await fetch(`/api/data/${fileName}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fileName}`)
    }
    const csvContent = await response.text()
    
    const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l)
    if (lines.length === 0) {
      throw new Error('Empty CSV file')
    }
    
    // Parse schema from first line
    const schemaLine = lines[0]
    const columns = schemaLine.split(',').map(col => {
      const parts = col.split(':')
      const name = parts[0].trim()
      let type = parts.length > 1 ? parts[1].trim().toUpperCase() : 'TEXT'
      // Accept INT as synonym for INTEGER
      if (type === 'INT') {
        type = 'INTEGER'
      }
      if (!['TEXT', 'INTEGER', 'REAL'].includes(type)) {
        throw new Error(`Invalid column type: ${type}`)
      }
      return { name, type }
    })
    
    // Get table name from filename
    const tableName = fileName.replace(/\.csv$/i, '')
    
    // Create table - escape column names to handle reserved keywords
    const columnDefs = columns.map(col => `${this.escapeIdentifier(col.name)} ${col.type}`).join(', ')
    const createSQL = `CREATE TABLE IF NOT EXISTS ${this.escapeIdentifier(tableName)} (${columnDefs})`
    
    this.db.run(createSQL)
    this.log(`Created table: ${tableName}`)
    
    // Insert data
    if (lines.length > 1) {
      const placeholders = columns.map(() => '?').join(', ')
      const insertSQL = `INSERT INTO ${this.escapeIdentifier(tableName)} (${columns.map(c => this.escapeIdentifier(c.name)).join(', ')}) VALUES (${placeholders})`
      
      const stmt = this.db.prepare(insertSQL)
      
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i])
        if (values.length !== columns.length) {
          throw new Error(`Row ${i + 1} has ${values.length} values but expected ${columns.length}`)
        }
        
        // Convert values to appropriate types
        const typedValues = values.map((val, idx) => {
          const col = columns[idx]
          if (col.type === 'INTEGER') {
            return parseInt(val) || 0
          } else if (col.type === 'REAL') {
            return parseFloat(val) || 0.0
          }
          return val
        })
        
        stmt.run(typedValues)
      }
      
      stmt.free()
    }
    
    this.log(`Loaded ${lines.length - 1} rows into ${tableName}`)
  }

  parseCSVLine(line) {
    const values = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current)
        current = ''
      } else {
        current += char
      }
    }
    
    values.push(current)
    return values
  }

  escapeIdentifier(name) {
    return `"${name.replace(/"/g, '""')}"`
  }

  getTableNames() {
    const result = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    if (result.length === 0) return []
    return result[0].values.map(row => row[0])
  }

  getTableData(tableName) {
    const result = this.db.exec(`SELECT * FROM ${this.escapeIdentifier(tableName)}`)
    if (result.length === 0) {
      return { columns: [], data: [] }
    }
    
    const columns = result[0].columns.map((name, idx) => {
      // Get column type from schema
      const schemaResult = this.db.exec(`PRAGMA table_info(${this.escapeIdentifier(tableName)})`)
      const colInfo = schemaResult[0].values.find(row => row[1] === name)
      let type = colInfo ? colInfo[2] : 'TEXT'
      // Normalize INT to INTEGER for consistency
      if (type === 'INT') {
        type = 'INTEGER'
      }
      return { name, type }
    })
    
    const data = result[0].values.map(row => {
      const obj = {}
      columns.forEach((col, idx) => {
        obj[col.name] = row[idx]
      })
      return obj
    })
    
    return { columns, data }
  }

  async generateSQL(naturalLanguage, defaultTable) {
    // Check for macro expansion first
    let expandedCommand = naturalLanguage
    try {
      const macroResult = this.expandMacro(naturalLanguage)
      if (macroResult.isMacro) {
        expandedCommand = macroResult.expandedText
        this.log(`Macro expanded to: ${expandedCommand}`)
      }
    } catch (err) {
      this.log(`Macro expansion error: ${err.message}`)
      throw err
    }
    
    this.log(`Generating SQL for: ${expandedCommand}`)
    
    const prompt = `You are a SQL expert. Generate SQLite SQL queries based on natural language requests.

Rules:
- Use SQLite syntax
- Do NOT use "INTO" in statements (use INSERT INTO table_name VALUES ... or UPDATE table_name SET ...)
- The default table is: ${defaultTable || 'none'}
- Return ONLY the SQL statement, no explanations, no markdown, no code blocks
- Make sure the SQL is valid and can be executed directly
- If the query involves a table, use the table name from the context

Natural language request: ${expandedCommand}

SQL:`

    const url = `http://${this.llmConfig.address}:${this.llmConfig.port}/api/generate`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.llmConfig.model,
          prompt: prompt,
          stream: false
        })
      })
      
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`)
      }
      
      const data = await response.json()
      let sql = data.response || ''
      
      // Extract SQL from markdown code blocks if present
      sql = sql.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim()
      
      // Remove any leading/trailing comments
      sql = sql.replace(/^--.*$/gm, '').trim()
      
      // Collapse to one line
      sql = sql.replace(/\s+/g, ' ').trim()
      
      // Remove square brackets if present (they might be added by the LLM)
      sql = sql.replace(/^\[|\]$/g, '')
      
      this.log(`Generated SQL: ${sql}`)
      return sql
    } catch (err) {
      this.log(`SQL generation error: ${err.message}`)
      throw err
    }
  }

  async executeSQL(sql) {
    try {
      this.log(`Executing SQL: ${sql}`)
      
      // Execute SQL
      const result = this.db.exec(sql)
      
      this.log('SQL executed successfully')
      return { success: true, result }
    } catch (err) {
      this.log(`SQL execution error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async deleteTable(tableName) {
    this.db.run(`DROP TABLE IF EXISTS ${this.escapeIdentifier(tableName)}`)
    this.log(`Deleted table: ${tableName}`)
  }

  async saveTableToCSV(tableName) {
    const result = this.getTableData(tableName)
    
    if (result.columns.length === 0) {
      throw new Error('Table has no columns')
    }
    
    // Build CSV content
    const schemaLine = result.columns.map(col => `${col.name}:${col.type}`).join(',')
    const dataLines = result.data.map(row => {
      return result.columns.map(col => {
        const value = row[col.name]
        // Handle CSV escaping - if value contains comma, quote, or newline, wrap in quotes
        const str = String(value === null || value === undefined ? '' : value)
        // Replace newlines with spaces to ensure one record per line
        const cleanStr = str.replace(/\n/g, ' ').replace(/\r/g, '')
        if (cleanStr.includes(',') || cleanStr.includes('"')) {
          return `"${cleanStr.replace(/"/g, '""')}"`
        }
        return cleanStr
      }).join(',')
    })
    
    const csvContent = [schemaLine, ...dataLines].join('\n')
    
    this.log(`Attempting to save table ${tableName} to CSV (${result.data.length} rows)`)
    
    // Save to file via API
    try {
      const response = await fetch('/api/save-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          csvContent
        })
      })
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch (e) {
          // Response is not JSON, try to get text
          try {
            const text = await response.text()
            if (text) errorMessage = text
          } catch (e2) {
            this.log(`Error parsing error response: ${e2.message}`)
          }
        }
        this.log(`Save CSV failed: ${errorMessage}`)
        throw new Error(`Failed to save CSV file: ${errorMessage}`)
      }
      
      const result = await response.json()
      this.log(`Saved table ${tableName} to CSV successfully`)
    } catch (err) {
      this.log(`Error in saveTableToCSV: ${err.message}`)
      if (err.message.includes('Failed to save CSV file')) {
        throw err
      }
      throw new Error(`Failed to save CSV file: ${err.message}`)
    }
  }

  async processCommandsFile() {
    try {
      const response = await fetch('/api/commands.txt')
      if (!response.ok) {
        this.log('commands.txt not found, skipping')
        return { commands: [] }
      }
      
      const content = await response.text()
      const lines = content.split('\n').map(l => l.trim()).filter(l => l)
      
      if (lines.length === 0) {
        this.log('commands.txt is empty')
        return { commands: [] }
      }
      
      this.log(`Found ${lines.length} commands in commands.txt`)
      return { commands: lines }
    } catch (err) {
      this.log(`Error reading commands.txt: ${err.message}`)
      return { commands: [] }
    }
  }

  async processCommandLine(line, defaultTable) {
    // Check if it's a special command
    if (line.startsWith('!')) {
      if (line.startsWith('!REM')) {
        this.log('Remark command - no action')
        return { success: true, sql: null }
      } else if (line.startsWith('!SAVE')) {
        const parts = line.split(/\s+/)
        const tableName = parts[1] || defaultTable
        if (!tableName) {
          throw new Error('!SAVE requires a table name')
        }
        await this.saveTableToCSV(tableName)
        return { success: true, sql: null }
      } else {
        throw new Error(`Unknown special command: ${line}`)
      }
    }
    
    // Check for macro expansion before SQL generation
    let commandToProcess = line
    try {
      const macroResult = this.expandMacro(line)
      if (macroResult.isMacro) {
        commandToProcess = macroResult.expandedText
        this.log(`Macro expanded to: ${commandToProcess}`)
      }
    } catch (err) {
      this.log(`Macro expansion error: ${err.message}`)
      throw err
    }
    
    // Normal command - needs SQL generation
    const sql = await this.generateSQL(commandToProcess, defaultTable)
    const result = await this.executeSQL(sql)
    
    if (!result.success) {
      throw new Error(`Error executing command "${line}": ${result.error}`)
    }
    
    return { success: true, sql }
  }

  async appendToCommandsFile(plainText, sql) {
    const response = await fetch('/api/commands.txt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plainText,
        sql
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to append to commands.txt')
    }
    
    this.log(`Appended to commands.txt`)
  }

  async updateCommandsFile(content) {
    const response = await fetch('/api/update-commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
    
    if (!response.ok) {
      throw new Error('Failed to update commands.txt')
    }
  }

  async insertRecord(tableName, columns, values) {
    const columnNames = columns.map(c => this.escapeIdentifier(c.name)).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT INTO ${this.escapeIdentifier(tableName)} (${columnNames}) VALUES (${placeholders})`
    
    const typedValues = columns.map((col, idx) => {
      const val = values[col.name]
      if (col.type === 'INTEGER') {
        return parseInt(val) || 0
      } else if (col.type === 'REAL') {
        return parseFloat(val) || 0.0
      }
      return val || ''
    })
    
    this.db.run(sql, typedValues)
    this.log(`Inserted record into ${tableName}`)
  }

  async updateRecord(tableName, columns, oldRow, newValues) {
    // Build WHERE clause from old row values
    const whereClause = columns.map(col => {
      const val = oldRow[col.name]
      if (col.type === 'TEXT') {
        return `${this.escapeIdentifier(col.name)} = '${String(val).replace(/'/g, "''")}'`
      }
      return `${this.escapeIdentifier(col.name)} = ${val}`
    }).join(' AND ')
    
    // Build SET clause
    const setClause = columns.map(col => {
      const val = newValues[col.name]
      if (col.type === 'TEXT') {
        return `${this.escapeIdentifier(col.name)} = '${String(val).replace(/'/g, "''")}'`
      }
      return `${this.escapeIdentifier(col.name)} = ${val}`
    }).join(', ')
    
    const sql = `UPDATE ${this.escapeIdentifier(tableName)} SET ${setClause} WHERE ${whereClause}`
    this.db.run(sql)
    this.log(`Updated record in ${tableName}`)
  }

  async deleteRecord(tableName, columns, row) {
    const whereClause = columns.map(col => {
      const val = row[col.name]
      if (col.type === 'TEXT') {
        return `${this.escapeIdentifier(col.name)} = '${String(val).replace(/'/g, "''")}'`
      }
      return `${this.escapeIdentifier(col.name)} = ${val}`
    }).join(' AND ')
    
    const sql = `DELETE FROM ${this.escapeIdentifier(tableName)} WHERE ${whereClause}`
    this.db.run(sql)
    this.log(`Deleted record from ${tableName}`)
  }
}
