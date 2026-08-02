import express from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { signJwt } from '../utils/jwt.js'

const router = express.Router()



router.post('/login', async (req, res) => {
  const employeeId = String(req.body.employeeId || '').trim().toUpperCase()
  const password = String(req.body.password || '')
  if (!/^[A-Z0-9]+$/.test(employeeId) || !password) {
    return res.status(400).json({ message: 'Enter a valid employee ID and password.' })
  }

  let account = await User.findOne({ employeeId }).select('+passwordHash')
  let role = account ? account.role : null
  let accessibleModules = []

  if (account) {
    if (account.accessibleModules && account.accessibleModules.length > 0) {
      accessibleModules = account.accessibleModules
    } else if (role === 'Admin') {
      accessibleModules = ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing', 'users']
    } else if (role === 'Manager') {
      accessibleModules = ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing']
    }
  }

  let isAdminFosLogin = false;
  if (!account && employeeId.endsWith('FOS') && (employeeId.startsWith('ADM') || employeeId.startsWith('MGR'))) {
    const adminEquivalentId = employeeId.slice(0, -3);
    account = await User.findOne({ employeeId: adminEquivalentId }).select('+passwordHash')
    if (account && (account.role === 'Admin' || account.role === 'Manager')) {
      role = account.role;
      isAdminFosLogin = true;
      if (account.accessibleModules && account.accessibleModules.length > 0) {
        accessibleModules = account.accessibleModules
      } else if (role === 'Manager') {
        accessibleModules = ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing']
      }
    } else {
      account = null;
    }
  }

  const ok = account && await bcrypt.compare(password, account.passwordHash)
  if (!ok) return res.status(401).json({ message: 'Incorrect employee ID or password.' })

  const accountType = isAdminFosLogin ? 'user' : ((role === 'Admin' || role === 'Manager') ? 'admin' : 'user')
  const name = account.name || 'Divyanshu Tiwari'

  const tokenPayload = { employeeId: account.employeeId, role, accountType, name, accessibleModules, createdAt: Date.now() }
  const token = signJwt(tokenPayload, req.body.rememberMe)
  return res.json({ token, user: { employeeId: account.employeeId, role, accountType, name, accessibleModules } })
})

export default router
