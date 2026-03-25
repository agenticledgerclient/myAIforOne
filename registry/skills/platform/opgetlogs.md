# Show Backend Server Logs

Display the current backend server logs from running background tasks.

## Instructions

When this skill is invoked:

1. **List all running background tasks** by running:
   ```bash
   ls -la "C:\Users\oreph\AppData\Local\Temp\claude\C--Users-oreph\tasks\"
   ```

2. **Find the most recent .output file** (this is the current server's log)

3. **Read the last 100 lines** of that output file using the Read tool

4. **Display the logs** to the user, highlighting:
   - Errors: lines containing `[stderr]`, `Error:`, or `error:`
   - Scheduler activity: lines containing `[Scheduler]`
   - Database connections: lines containing `Connected to PostgreSQL`

5. **Tell the user** how to watch logs continuously in PowerShell:
   ```powershell
   Get-Content "C:\Users\oreph\AppData\Local\Temp\claude\C--Users-oreph\tasks\<TASK_ID>.output" -Wait -Tail 50
   ```

## Common Task IDs
- Backend server typically runs as a background bash task
- Check `/tasks` to see all running tasks and their IDs
