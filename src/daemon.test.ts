import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// Mock modules before importing
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('./config.js', () => ({
  PID_FILE: '/tmp/test.pid',
  LOG_FILE: '/tmp/test.log',
}))

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  readPid,
  isProcessRunning,
  checkDaemon,
  handleStop,
  handleStatus,
  handleDaemon,
  logDaemon,
  isDaemonChild,
  initDaemonChild,
} from './daemon.js'

describe('daemon', () => {
  let mockExit: Mock
  let mockKill: Mock
  let mockConsoleLog: Mock
  let mockConsoleError: Mock
  let originalArgv: string[]

  beforeEach(() => {
    vi.clearAllMocks()

    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as () => never)
    mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    originalArgv = process.argv
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // readPid
  // ---------------------------------------------------------------------------

  describe('readPid', () => {
    it('returns null when PID file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      expect(readPid()).toBeNull()
    })

    it('returns PID when file exists with valid content', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      expect(readPid()).toBe(12345)
    })

    it('returns PID when file contains whitespace', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('  67890\n')
      expect(readPid()).toBe(67890)
    })

    it('returns NaN for non-numeric content', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('not-a-number')
      expect(readPid()).toBeNaN()
    })

    it('returns null when readFileSync throws', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File read error')
      })
      expect(readPid()).toBeNull()
    })

    it('returns null when existsSync throws', () => {
      vi.mocked(existsSync).mockImplementation(() => {
        throw new Error('File system error')
      })
      expect(readPid()).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // isProcessRunning
  // ---------------------------------------------------------------------------

  describe('isProcessRunning', () => {
    it('returns true when process.kill(pid, 0) succeeds', () => {
      mockKill.mockReturnValue(true)
      expect(isProcessRunning(12345)).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(12345, 0)
    })

    it('returns false when process.kill(pid, 0) throws', () => {
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })
      expect(isProcessRunning(99999)).toBe(false)
      expect(mockKill).toHaveBeenCalledWith(99999, 0)
    })
  })

  // ---------------------------------------------------------------------------
  // checkDaemon
  // ---------------------------------------------------------------------------

  describe('checkDaemon', () => {
    it('exits with code 1 when daemon is already running', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockReturnValue(true) // Process is running

      expect(() => checkDaemon()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'Daemon already running (PID: 12345). Use --stop to stop it first.'
      )
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('does nothing when no PID file exists', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      // Should not throw or exit
      checkDaemon()
      expect(mockExit).not.toHaveBeenCalled()
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('does nothing when process is not running', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      checkDaemon()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('does nothing when PID is null', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      checkDaemon()
      expect(mockExit).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // handleStop
  // ---------------------------------------------------------------------------

  describe('handleStop', () => {
    it('stops running daemon and removes PID file', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockImplementation((pid, signal) => {
        if (signal === 0) return true // isProcessRunning check
        if (signal === 'SIGTERM') return true // actual kill
        return true
      })

      expect(() => handleStop()).toThrow('process.exit called')
      expect(mockKill).toHaveBeenCalledWith(12345, 'SIGTERM')
      expect(mockConsoleLog).toHaveBeenCalledWith('Stopped daemon (PID: 12345)')
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('handles case when PID file does not exist after stopping', () => {
      let killCount = 0
      vi.mocked(existsSync).mockImplementation(() => {
        // First call (readPid) returns true, second call (after kill) returns false
        killCount++
        return killCount <= 2
      })
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockReturnValue(true)

      expect(() => handleStop()).toThrow('process.exit called')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('prints "No daemon running" when PID file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      expect(() => handleStop()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('No daemon running')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('prints "No daemon running" when process is not running', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      expect(() => handleStop()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('No daemon running')
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('cleans up stale PID file when no daemon running', () => {
      let existsCallCount = 0
      vi.mocked(existsSync).mockImplementation(() => {
        existsCallCount++
        // readPid check returns true (file exists)
        // isProcessRunning will fail
        // cleanup check also returns true
        return true
      })
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      expect(() => handleStop()).toThrow('process.exit called')
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
    })

    it('exits with code 1 when kill fails', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      
      let killCallCount = 0
      mockKill.mockImplementation(() => {
        killCallCount++
        if (killCallCount === 1) return true // isProcessRunning returns true
        throw new Error('EPERM') // actual kill fails
      })

      expect(() => handleStop()).toThrow('process.exit called')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  // ---------------------------------------------------------------------------
  // handleStatus
  // ---------------------------------------------------------------------------

  describe('handleStatus', () => {
    it('reports daemon is running when process exists', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockReturnValue(true)

      expect(() => handleStatus()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('Daemon is running (PID: 12345)')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('reports daemon is not running when no PID file', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      expect(() => handleStatus()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('Daemon is not running')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('reports daemon is not running when process does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      expect(() => handleStatus()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('Daemon is not running')
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('cleans up stale PID file when daemon not running', () => {
      let existsCallCount = 0
      vi.mocked(existsSync).mockImplementation(() => {
        existsCallCount++
        return true // File always exists for this test
      })
      vi.mocked(readFileSync).mockReturnValue('99999')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      expect(() => handleStatus()).toThrow('process.exit called')
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
    })
  })

  // ---------------------------------------------------------------------------
  // handleDaemon
  // ---------------------------------------------------------------------------

  describe('handleDaemon', () => {
    it('reports daemon already running when process exists', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('12345')
      mockKill.mockReturnValue(true)

      expect(() => handleDaemon()).toThrow('process.exit called')
      expect(mockConsoleLog).toHaveBeenCalledWith('Daemon already running (PID: 12345)')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('spawns new daemon when none is running', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      }
      vi.mocked(spawn).mockReturnValue(mockChild as any)

      process.argv = ['node', '/path/to/script.js']

      expect(() => handleDaemon()).toThrow('process.exit called')
      
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        ['/path/to/script.js', '--daemon-child'],
        {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        }
      )
      expect(mockChild.unref).toHaveBeenCalled()
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith('/tmp/test.pid', '54321')
      expect(mockConsoleLog).toHaveBeenCalledWith('Started daemon (PID: 54321)')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('spawns new daemon when PID file exists but process is dead', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('99999')
      mockKill.mockImplementation(() => {
        throw new Error('ESRCH')
      })

      const mockChild = {
        pid: 11111,
        unref: vi.fn(),
      }
      vi.mocked(spawn).mockReturnValue(mockChild as any)

      process.argv = ['node', '/path/to/script.js']

      expect(() => handleDaemon()).toThrow('process.exit called')
      
      expect(spawn).toHaveBeenCalled()
      expect(mockConsoleLog).toHaveBeenCalledWith('Started daemon (PID: 11111)')
    })
  })

  // ---------------------------------------------------------------------------
  // logDaemon
  // ---------------------------------------------------------------------------

  describe('logDaemon', () => {
    it('writes timestamped message to log file', () => {
      const mockDate = new Date('2024-01-15T10:30:00.000Z')
      vi.setSystemTime(mockDate)

      logDaemon('Test message')

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/tmp/test.log',
        '[2024-01-15T10:30:00.000Z] Test message\n',
        { flag: 'a' }
      )

      vi.useRealTimers()
    })

    it('silently ignores write errors', () => {
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('Write failed')
      })

      // Should not throw
      expect(() => logDaemon('Test message')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // isDaemonChild
  // ---------------------------------------------------------------------------

  describe('isDaemonChild', () => {
    it('returns true when --daemon-child is in argv', () => {
      process.argv = ['node', 'script.js', '--daemon-child']
      expect(isDaemonChild()).toBe(true)
    })

    it('returns false when --daemon-child is not in argv', () => {
      process.argv = ['node', 'script.js', '--daemon']
      expect(isDaemonChild()).toBe(false)
    })

    it('returns false for empty argv', () => {
      process.argv = []
      expect(isDaemonChild()).toBe(false)
    })

    it('returns true when --daemon-child is among other args', () => {
      process.argv = ['node', 'script.js', '--verbose', '--daemon-child', '--port=8080']
      expect(isDaemonChild()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // initDaemonChild
  // ---------------------------------------------------------------------------

  describe('initDaemonChild', () => {
    let mockOn: Mock
    let signalHandlers: Map<string, () => void>

    beforeEach(() => {
      signalHandlers = new Map()
      mockOn = vi.spyOn(process, 'on').mockImplementation((event: string, handler: () => void) => {
        signalHandlers.set(event, handler)
        return process
      })

      // Reset writeFileSync to default behavior (previous test may have set it to throw)
      vi.mocked(writeFileSync).mockReset()

      // Mock Date for consistent timestamps
      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('writes PID file with current process PID', () => {
      initDaemonChild()

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/tmp/test.pid',
        String(process.pid)
      )
    })

    it('logs daemon startup message', () => {
      initDaemonChild()

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining(`Daemon started (PID: ${process.pid})`),
        { flag: 'a' }
      )
    })

    it('registers SIGTERM handler', () => {
      initDaemonChild()

      expect(mockOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    })

    it('registers SIGINT handler', () => {
      initDaemonChild()

      expect(mockOn).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    })

    it('SIGTERM handler cleans up and exits', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      
      initDaemonChild()
      
      const sigtermHandler = signalHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      expect(() => sigtermHandler!()).toThrow('process.exit called')
      
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('Received SIGTERM, shutting down'),
        { flag: 'a' }
      )
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('SIGINT handler cleans up and exits', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      
      initDaemonChild()
      
      const sigintHandler = signalHandlers.get('SIGINT')
      expect(sigintHandler).toBeDefined()

      expect(() => sigintHandler!()).toThrow('process.exit called')
      
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('Received SIGINT, shutting down'),
        { flag: 'a' }
      )
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith('/tmp/test.pid')
      expect(mockExit).toHaveBeenCalledWith(0)
    })

    it('signal handler skips unlinkSync when PID file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      
      initDaemonChild()
      
      // Clear mock calls from initDaemonChild setup
      vi.mocked(unlinkSync).mockClear()
      
      const sigtermHandler = signalHandlers.get('SIGTERM')
      expect(() => sigtermHandler!()).toThrow('process.exit called')
      
      expect(vi.mocked(unlinkSync)).not.toHaveBeenCalled()
    })
  })
})
