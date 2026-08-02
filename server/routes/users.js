import express from 'express'
import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { getEmployeeIdFromReq } from '../utils/helpers.js'

const router = express.Router()

router.get('/me/prefs', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized' })
  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found' })
  res.json({ lastViewedCases: user.lastViewedCases || null })
})

router.put('/me/prefs', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized' })
  const { lastViewedCases } = req.body
  const user = await User.findOneAndUpdate({ employeeId }, { $set: { lastViewedCases } }, { returnDocument: 'after' })
  res.json({ lastViewedCases: user.lastViewedCases })
})

router.get('/', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 })
  res.json({ users })
})

router.post('/', async (req, res) => {
  const { employeeId, name, password, role, fosIdentifier } = req.body
  if (!employeeId || !name || !password || !role) {
    return res.status(400).json({ message: 'All fields are required.' })
  }

  const upperId = employeeId.toUpperCase()
  if (role === 'Field Employee' && !/^FOS\d{3}$/.test(upperId)) {
    return res.status(400).json({ message: 'Field Employee ID must be in the format FOSXXX.' })
  }
  if ((role === 'Manager' || role === 'Admin') && !/^ADM\d{3}$/.test(upperId)) {
    return res.status(400).json({ message: 'Manager and Admin IDs must be in the format ADMXXX.' })
  }

  const existing = await User.findOne({ employeeId: employeeId.toUpperCase() })
  if (existing) {
    return res.status(409).json({ message: 'User already exists.' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await User.create({ employeeId: employeeId.toUpperCase(), name: name.trim(), passwordHash, role, fosIdentifier: fosIdentifier ? fosIdentifier.trim() : '' })

  res.status(201).json({ user })
})

router.put('/:id', async (req, res) => {
  const { name, role, password, fosIdentifier } = req.body
  const updateData = {}

  if (name) updateData.name = name.trim()
  if (fosIdentifier !== undefined) updateData.fosIdentifier = fosIdentifier.trim()

  if (role) updateData.role = role
  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, 10)
  }
  if (req.body.accessibleModules) {
    updateData.accessibleModules = req.body.accessibleModules
  }

  const user = await User.findByIdAndUpdate(req.params.id, updateData, { returnDocument: 'after' })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  res.json({ user })
})

router.delete('/:id', async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  res.json({ message: 'User deleted.' })
})

router.get('/:id/permissions', async (req, res) => {
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  res.json({ permissions: user.permissions || {} })
})

router.put('/:id/permissions', async (req, res) => {
  const { permissions } = req.body
  if (permissions === undefined) return res.status(400).json({ message: 'permissions is required.' })
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { permissions } },
    { returnDocument: 'after' }
  )
  if (!user) return res.status(404).json({ message: 'User not found.' })
  res.json({ user })
})

export default router
