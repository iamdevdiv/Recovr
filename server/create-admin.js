import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectDatabase } from './database.js'
import { User } from './models/User.js'

const [,, employeeId, password, name] = process.argv

if (!employeeId || !password || !name) {
  console.error('Usage: node server/create-admin.js <employeeId> <password> "<Name>"')
  console.error('Example: node server/create-admin.js ADM629 mypassword "John Doe"')
  process.exit(1)
}

async function run() {
  try {
    await connectDatabase()

    const existingUser = await User.findOne({ employeeId })
    if (existingUser) {
      console.error(`Error: User with Employee ID ${employeeId} already exists!`)
      process.exit(1)
    }

    const salt = await bcrypt.genSalt(12)
    const passwordHash = await bcrypt.hash(password, salt)

    await User.create({
      employeeId,
      name,
      role: 'Admin',
      passwordHash
    })

    console.log(`Administrator ${employeeId} (${name}) created successfully!`)
    process.exit(0)
  } catch (error) {
    console.error('Error creating admin:', error)
    process.exit(1)
  }
}

run()
