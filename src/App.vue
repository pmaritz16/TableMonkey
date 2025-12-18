<template>
  <div id="app">
    <div class="header">
      <button @click="restart" class="restart-btn">Restart</button>
      <h1>TableMonkey</h1>
    </div>
    
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
    
    <div v-if="loading" class="loading">
      {{ loadingMessage }}
    </div>
    
    <div v-if="!error && !loading && initialized">
      <div class="command-section">
        <div class="command-input-group">
          <input 
            v-model="commandText" 
            @keyup.enter="executeCommand"
            placeholder="Enter command (use ! for special commands)"
            class="command-input"
          />
          <button @click="executeCommand" :disabled="processing" class="action-btn execute-btn">
            {{ processing ? 'Processing...' : 'Execute' }}
          </button>
          <button @click="saveCommand" :disabled="!lastCommandSuccess || !commandText" class="action-btn save-btn">Save</button>
        </div>
        <div v-if="processing && !generatedSQL" class="processing-indicator">
          Generating SQL from LLM...
        </div>
        <div v-if="generatedSQL" class="sql-display">
          <label>Generated SQL:</label>
          <textarea v-model="generatedSQL" readonly class="sql-textarea"></textarea>
        </div>
      </div>
      
      <div class="table-section">
        <div class="table-controls">
          <select v-model="currentTableName" @change="loadTableData" class="table-selector">
            <option value="">Select a table</option>
            <option v-for="table in tableNames" :key="table" :value="table">{{ table }}</option>
          </select>
          <div class="direct-commands">
            <select v-model="selectedDirectCommand" @change="handleDirectCommand" class="direct-command-select">
              <option value="">Direct Commands...</option>
              <option value="delete">Delete Table</option>
              <option value="save">Save Table</option>
            </select>
          </div>
          <div class="record-actions">
            <button @click="addRecord" :disabled="!currentTableName" class="action-btn add-btn">Add Record</button>
            <button @click="editSelectedRecord" :disabled="!currentTableName || selectedRowIndex === null" class="action-btn edit-btn">Edit Record</button>
            <button @click="deleteSelectedRecord" :disabled="!currentTableName || selectedRowIndex === null" class="action-btn delete-btn">Delete Record</button>
          </div>
        </div>
        
        <div v-if="currentTableName && tableData.length > 0" class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="col in tableColumns" :key="col.name" class="table-header">{{ col.name }} ({{ col.type }})</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="(row, idx) in tableData" 
                :key="idx"
                :class="{ selected: selectedRowIndex === idx }"
                @click="selectedRowIndex = idx"
              >
                <td v-for="col in tableColumns" :key="col.name" class="table-cell">{{ row[col.name] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="currentTableName" class="no-data">
          No data in table
        </div>
      </div>
    </div>
    
    <!-- Record Edit/Add Modal -->
    <div v-if="showRecordModal" class="modal-overlay" @click.self="closeRecordModal">
      <div class="modal-content">
        <h2>{{ editingRecord ? 'Edit Record' : 'Add Record' }}</h2>
        <form @submit.prevent="saveRecord">
          <div v-for="col in tableColumns" :key="col.name" class="form-field">
            <label>{{ col.name }} ({{ col.type }}):</label>
            <input 
              v-model="recordForm[col.name]" 
              :type="getInputType(col.type)"
              :step="getInputStep(col.type)"
              class="form-input"
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="action-btn">Save</button>
            <button type="button" @click="closeRecordModal" class="action-btn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
    
    <!-- Alert Modal -->
    <div v-if="showAlert" class="modal-overlay" @click.self="dismissAlert">
      <div class="modal-content alert-modal">
        <h2>{{ alertTitle }}</h2>
        <p>{{ alertMessage }}</p>
        <button @click="dismissAlert" class="action-btn">OK</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch } from 'vue'
import initSqlJs from 'sql.js'
import { TableMonkeyCore } from './core.js'

export default {
  name: 'App',
  setup() {
    const core = ref(null)
    const error = ref(null)
    const loading = ref(true)
    const loadingMessage = ref('Initializing...')
    const initialized = ref(false)
    
    const tableNames = ref([])
    const currentTableName = ref('')
    const tableColumns = ref([])
    const tableData = ref([])
    const selectedRowIndex = ref(null)
    
    const commandText = ref('')
    const generatedSQL = ref('')
    const processing = ref(false)
    const lastCommandSuccess = ref(false)
    const selectedDirectCommand = ref('')
    
    const showRecordModal = ref(false)
    const editingRecord = ref(false)
    const recordForm = ref({})
    
    const showAlert = ref(false)
    const alertTitle = ref('')
    const alertMessage = ref('')
    
    const initialize = async () => {
      try {
        loading.value = true
        loadingMessage.value = 'Loading SQL.js...'
        log('Starting TableMonkey application')
        
        const SQL = await initSqlJs({
          locateFile: file => `https://sql.js.org/dist/${file}`
        })
        
        loadingMessage.value = 'Initializing core...'
        core.value = new TableMonkeyCore(SQL)
        
        loadingMessage.value = 'Loading configuration...'
        await core.value.initialize()
        
        loadingMessage.value = 'Loading CSV files...'
        await core.value.loadCSVFiles()
        
        loadingMessage.value = 'Processing commands.txt...'
        await processCommandsFile()
        
        tableNames.value = core.value.getTableNames()
        if (tableNames.value.length > 0) {
          currentTableName.value = tableNames.value[0]
          loadTableData()
        }
        
        initialized.value = true
        loading.value = false
        log('Application initialized successfully')
      } catch (err) {
        error.value = err.message
        loading.value = false
        log(`Error during initialization: ${err.message}`)
      }
    }
    
    const log = (message) => {
      if (core.value) {
        core.value.log(message)
      } else {
        console.log(message)
      }
    }
    
    const processCommandsFile = async () => {
      try {
        const result = await core.value.processCommandsFile()
        const commands = result.commands
        
        if (commands.length === 0) {
          return
        }
        
        // Read current commands.txt content to process
        const response = await fetch('/api/commands.txt')
        if (!response.ok) {
          return
        }
        
        const content = await response.text()
        const allLines = content.split('\n')
        const lines = allLines.map(l => l.trim()).filter(l => l)
        
        // Count actual commands (not SQL lines)
        const commandLines = lines.filter((l, idx) => {
          // Skip SQL lines in brackets
          if (l.startsWith('[') && l.endsWith(']')) {
            return false
          }
          // Skip if previous line was a command and this is its SQL
          if (idx > 0 && lines[idx - 1] && !lines[idx - 1].startsWith('[') && !lines[idx - 1].endsWith(']')) {
            // This might be SQL, check if next is SQL
            if (idx + 1 < lines.length && lines[idx + 1].startsWith('[') && lines[idx + 1].endsWith(']')) {
              return false
            }
          }
          return true
        })
        const totalCommands = commandLines.length
        
        let commandIndex = 0
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          
          // Skip if it's SQL in brackets (already processed)
          if (line.startsWith('[') && line.endsWith(']')) {
            i++
            continue
          }
          
          commandIndex++
          
          // Check if next line is SQL in brackets
          if (i + 1 < lines.length && lines[i + 1].startsWith('[') && lines[i + 1].endsWith(']')) {
            // Use existing SQL
            const sql = lines[i + 1].slice(1, -1).trim()
            loadingMessage.value = `Processing command ${commandIndex}/${totalCommands}: ${line}`
            log(`Using cached SQL for: ${line}`)
            
            const result = await core.value.executeSQL(sql)
            if (!result.success) {
              throw new Error(`Error executing command "${line}": ${result.error}`)
            }
            
            // Refresh tables
            tableNames.value = core.value.getTableNames()
            if (currentTableName.value && tableNames.value.includes(currentTableName.value)) {
              loadTableData()
            }
            
            i += 2
          } else {
            // Generate SQL
            loadingMessage.value = `Processing command ${commandIndex}/${totalCommands}: ${line}`
            
            if (line.startsWith('!')) {
              // Special command
              const result = await core.value.processCommandLine(line, currentTableName.value)
              if (!result.success) {
                throw new Error(`Error executing special command "${line}"`)
              }
              i++
            } else {
              // Normal command - generate SQL
              const sql = await core.value.generateSQL(line, currentTableName.value)
              const result = await core.value.executeSQL(sql)
              
              if (!result.success) {
                throw new Error(`Error executing command "${line}": ${result.error}`)
              }
              
              // Insert SQL into file
              const newContent = await fetch('/api/commands.txt').then(r => r.text())
              const newLines = newContent.split('\n')
              const insertIndex = newLines.findIndex((l, idx) => {
                const trimmed = l.trim()
                return trimmed === line && (idx === newLines.length - 1 || newLines[idx + 1].trim() !== `[${sql}]`)
              })
              
              if (insertIndex !== -1) {
                newLines.splice(insertIndex + 1, 0, `[${sql}]`)
                await core.value.updateCommandsFile(newLines.join('\n'))
                log(`Inserted SQL into commands.txt`)
              }
              
              // Refresh tables
              tableNames.value = core.value.getTableNames()
              if (currentTableName.value && tableNames.value.includes(currentTableName.value)) {
                loadTableData()
              }
              
              i++
            }
          }
        }
        
        loadingMessage.value = `All ${totalCommands} commands processed successfully`
        log('All commands from commands.txt processed successfully')
        
        // Show completion message - will be dismissed by user
        showAlertDialog('Success', `All ${totalCommands} commands from commands.txt have been processed successfully.`)
        
      } catch (err) {
        log(`Error processing commands.txt: ${err.message}`)
        showAlertDialog('Error', `Error processing commands.txt: ${err.message}`)
        throw err
      }
    }
    
    const loadTableData = () => {
      if (!currentTableName.value || !core.value) return
      
      try {
        const result = core.value.getTableData(currentTableName.value)
        tableColumns.value = result.columns
        tableData.value = result.data
        selectedRowIndex.value = null
        log(`Loaded table: ${currentTableName.value}`)
      } catch (err) {
        error.value = `Error loading table: ${err.message}`
        log(`Error loading table: ${err.message}`)
      }
    }
    
    const executeCommand = async () => {
      if (!commandText.value.trim() || processing.value) return
      
      const cmd = commandText.value.trim()
      processing.value = true
      generatedSQL.value = ''
      lastCommandSuccess.value = false
      
      try {
        log(`Executing command: ${cmd}`)
        
        if (cmd.startsWith('!')) {
          // Special command
          await handleSpecialCommand(cmd)
        } else {
          // Normal command - send to LLM (macro expansion happens inside generateSQL)
          log(`Processing command: ${cmd}`)
          const sql = await core.value.generateSQL(cmd, currentTableName.value)
          generatedSQL.value = sql
          log(`Received SQL: ${sql}`)
          
          const result = await core.value.executeSQL(sql)
          log(`SQL execution result: ${result.success ? 'Success' : 'Failed'}`)
          
          if (result.success) {
            lastCommandSuccess.value = true
            // Refresh table list and current table
            tableNames.value = core.value.getTableNames()
            if (currentTableName.value && tableNames.value.includes(currentTableName.value)) {
              loadTableData()
            } else if (tableNames.value.length > 0) {
              currentTableName.value = tableNames.value[0]
              loadTableData()
            }
          } else {
            showAlertDialog('Error', result.error || 'SQL execution failed')
            log(`SQL execution error: ${result.error}`)
          }
        }
      } catch (err) {
        showAlertDialog('Error', err.message)
        log(`Command execution error: ${err.message}`)
      } finally {
        processing.value = false
      }
    }
    
    const handleSpecialCommand = async (cmd) => {
      const result = await core.value.processCommandLine(cmd, currentTableName.value)
      if (result.success) {
        lastCommandSuccess.value = true
      } else {
        throw new Error('Special command failed')
      }
    }
    
    const saveCommand = async () => {
      if (!commandText.value.trim() || !lastCommandSuccess.value) return
      
      try {
        await core.value.appendToCommandsFile(commandText.value, generatedSQL.value)
        log(`Saved command to commands.txt`)
        showAlertDialog('Success', 'Command saved to commands.txt')
      } catch (err) {
        showAlertDialog('Error', `Failed to save command: ${err.message}`)
        log(`Error saving command: ${err.message}`)
      }
    }
    
    const handleDirectCommand = async () => {
      if (!selectedDirectCommand.value) return
      
      const cmd = selectedDirectCommand.value
      selectedDirectCommand.value = ''
      
      if (!currentTableName.value) {
        showAlertDialog('Error', 'No table selected')
        return
      }
      
      try {
        if (cmd === 'delete') {
          if (confirm(`Are you sure you want to delete table "${currentTableName.value}"?`)) {
            await core.value.deleteTable(currentTableName.value)
            log(`Deleted table: ${currentTableName.value}`)
            tableNames.value = core.value.getTableNames()
            if (tableNames.value.length > 0) {
              currentTableName.value = tableNames.value[0]
              loadTableData()
            } else {
              currentTableName.value = ''
              tableData.value = []
              tableColumns.value = []
            }
          }
        } else if (cmd === 'save') {
          await core.value.saveTableToCSV(currentTableName.value)
          log(`Saved table ${currentTableName.value} to CSV`)
          showAlertDialog('Success', `Table "${currentTableName.value}" saved to CSV`)
        }
      } catch (err) {
        showAlertDialog('Error', err.message)
        log(`Direct command error: ${err.message}`)
      }
    }
    
    const addRecord = () => {
      if (!currentTableName.value || tableColumns.value.length === 0) return
      
      editingRecord.value = false
      recordForm.value = {}
      
      // Set default values based on column types
      tableColumns.value.forEach(col => {
        const colType = col.type.toUpperCase()
        if (colType === 'INTEGER' || colType === 'INT') {
          recordForm.value[col.name] = 0
        } else if (colType === 'REAL') {
          recordForm.value[col.name] = 0.0
        } else {
          recordForm.value[col.name] = ''
        }
      })
      
      showRecordModal.value = true
    }
    
    const editSelectedRecord = () => {
      if (selectedRowIndex.value === null || !tableData.value[selectedRowIndex.value]) return
      
      editingRecord.value = true
      recordForm.value = { ...tableData.value[selectedRowIndex.value] }
      showRecordModal.value = true
    }
    
    const deleteSelectedRecord = async () => {
      if (selectedRowIndex.value === null || !tableData.value[selectedRowIndex.value]) return
      
      if (!confirm('Are you sure you want to delete this record?')) return
      
      try {
        const row = tableData.value[selectedRowIndex.value]
        await core.value.deleteRecord(currentTableName.value, tableColumns.value, row)
        log(`Deleted record from ${currentTableName.value}`)
        loadTableData()
      } catch (err) {
        showAlertDialog('Error', err.message)
        log(`Error deleting record: ${err.message}`)
      }
    }
    
    const saveRecord = async () => {
      try {
        // Validate types
        for (const col of tableColumns.value) {
          const value = recordForm.value[col.name]
          const colType = col.type.toUpperCase()
          if (colType === 'INTEGER' || colType === 'INT') {
            const intVal = parseInt(value)
            if (isNaN(intVal)) {
              throw new Error(`Invalid INTEGER value for ${col.name}`)
            }
            recordForm.value[col.name] = intVal
          } else if (colType === 'REAL') {
            // Handle empty string or null/undefined
            if (value === '' || value === null || value === undefined) {
              recordForm.value[col.name] = 0.0
            } else {
              const floatVal = parseFloat(value)
              if (isNaN(floatVal)) {
                throw new Error(`Invalid REAL value for ${col.name}`)
              }
              recordForm.value[col.name] = floatVal
            }
          }
        }
        
        if (editingRecord.value) {
          const oldRow = tableData.value[selectedRowIndex.value]
          await core.value.updateRecord(currentTableName.value, tableColumns.value, oldRow, recordForm.value)
          log(`Updated record in ${currentTableName.value}`)
        } else {
          await core.value.insertRecord(currentTableName.value, tableColumns.value, recordForm.value)
          log(`Inserted record into ${currentTableName.value}`)
        }
        
        closeRecordModal()
        loadTableData()
      } catch (err) {
        showAlertDialog('Error', err.message)
        log(`Error saving record: ${err.message}`)
      }
    }
    
    const closeRecordModal = () => {
      showRecordModal.value = false
      recordForm.value = {}
    }
    
    const getInputType = (colType) => {
      const normalizedType = colType.toUpperCase()
      if (normalizedType === 'INTEGER' || normalizedType === 'INT') return 'number'
      if (normalizedType === 'REAL') return 'number'
      return 'text'
    }
    
    const getInputStep = (colType) => {
      const normalizedType = colType.toUpperCase()
      if (normalizedType === 'REAL') return 'any'
      if (normalizedType === 'INTEGER' || normalizedType === 'INT') return '1'
      return undefined
    }
    
    const showAlertDialog = (title, message) => {
      alertTitle.value = title
      alertMessage.value = message
      showAlert.value = true
    }
    
    const dismissAlert = () => {
      showAlert.value = false
    }
    
    const restart = async () => {
      // Reset all state
      core.value = null
      error.value = null
      loading.value = true
      initialized.value = false
      tableNames.value = []
      currentTableName.value = ''
      tableData.value = []
      tableColumns.value = []
      commandText.value = ''
      generatedSQL.value = ''
      selectedRowIndex.value = null
      lastCommandSuccess.value = false
      processing.value = false
      
      // Reinitialize
      await initialize()
    }
    
    watch(currentTableName, () => {
      if (currentTableName.value) {
        loadTableData()
      }
    })
    
    onMounted(() => {
      initialize()
    })
    
    return {
      error,
      loading,
      loadingMessage,
      initialized,
      tableNames,
      currentTableName,
      tableColumns,
      tableData,
      selectedRowIndex,
      commandText,
      generatedSQL,
      processing,
      lastCommandSuccess,
      selectedDirectCommand,
      showRecordModal,
      editingRecord,
      recordForm,
      showAlert,
      alertTitle,
      alertMessage,
      executeCommand,
      saveCommand,
      handleDirectCommand,
      addRecord,
      editSelectedRecord,
      deleteSelectedRecord,
      saveRecord,
      closeRecordModal,
      getInputType,
      dismissAlert,
      restart,
      loadTableData,
      processCommandsFile,
      getInputStep
    }
  }
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background-color: #f5f5f5;
}

#app {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
}

.restart-btn {
  padding: 8px 16px;
  background-color: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  min-width: 80px;
}

.restart-btn:hover {
  background-color: #c82333;
}

h1 {
  color: #333;
}

.error-message {
  background-color: #f8d7da;
  color: #721c24;
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
  border: 1px solid #f5c6cb;
}

.loading {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 18px;
}

.processing-indicator {
  padding: 10px;
  background-color: #fff3cd;
  color: #856404;
  border-radius: 4px;
  margin-top: 10px;
  text-align: center;
  font-style: italic;
}

.command-section {
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.command-input-group {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.command-input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.action-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  min-width: 80px;
  max-width: 100px;
}

.execute-btn {
  background-color: #007bff;
  color: white;
}

.execute-btn:hover:not(:disabled) {
  background-color: #0056b3;
}

.save-btn {
  background-color: #28a745;
  color: white;
}

.save-btn:hover:not(:disabled) {
  background-color: #218838;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sql-display {
  margin-top: 15px;
}

.sql-display label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
  color: #333;
}

.sql-textarea {
  width: 100%;
  min-height: 60px;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  resize: vertical;
}

.table-section {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.table-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  align-items: center;
}

.table-selector {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  min-width: 200px;
  max-width: 300px;
}

.direct-command-select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  min-width: 150px;
}

.record-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.add-btn {
  background-color: #17a2b8;
  color: white;
}

.add-btn:hover:not(:disabled) {
  background-color: #138496;
}

.edit-btn {
  background-color: #ffc107;
  color: #333;
}

.edit-btn:hover:not(:disabled) {
  background-color: #e0a800;
}

.delete-btn {
  background-color: #dc3545;
  color: white;
}

.delete-btn:hover:not(:disabled) {
  background-color: #c82333;
}

.table-container {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table-header {
  background-color: #f8f9fa;
  padding: 12px;
  text-align: left;
  border-bottom: 2px solid #dee2e6;
  font-weight: 600;
  color: #495057;
}

.table-cell {
  padding: 10px 12px;
  border-bottom: 1px solid #dee2e6;
}

.data-table tbody tr {
  cursor: pointer;
}

.data-table tbody tr:hover {
  background-color: #f8f9fa;
}

.data-table tbody tr.selected {
  background-color: #e7f3ff;
}

.no-data {
  padding: 40px;
  text-align: center;
  color: #999;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 30px;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-content h2 {
  margin-bottom: 20px;
  color: #333;
}

.form-field {
  margin-bottom: 15px;
}

.form-field label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
  color: #333;
}

.form-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  justify-content: flex-end;
}

.alert-modal {
  text-align: center;
}

.alert-modal p {
  margin: 20px 0;
  color: #333;
}
</style>

