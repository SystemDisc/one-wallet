require('dotenv').config()
const { min, chunk, uniqBy } = require('lodash')
const { promises: fs } = require('fs')
const BN = require('bn.js')
const rlp = require('rlp')
const ONEUtil = require('../lib/util')
const { setConfig } = require('../lib/config/provider')
const config = require('../lib/config/common')
setConfig(config)
const { api, initBlockchain } = require('../lib/api')
initBlockchain()
const moment = require('moment-timezone')
const T0 = process.env.T0 ? Date.parse(process.env.T0) : Date.now() - 3600 * 1000 * 24 * 3
const RELAYER_ADDRESSES = (process.env.RELAYER_ADDRESSES || '0xc8cd0c9ca68b853f73917c36e9276770a8d8e4e0').split(',').map(s => s.toLowerCase().trim())
const STATS_CACHE = process.env.STATS_CACHE || './data/stats.json'
const ADDRESSES_CACHE = process.env.ADDRESSES_CACHE || './data/addresses.csv'
const MAX_BALANCE_AGE = parseInt(process.env.MAX_BALANCE_AGE || 3600 * 1000 * 24)
const SLEEP_BETWEEN_RPC = parseInt(process.env.SLEEP_BETWEEN_RPC || 100)
const RPC_BATCH_SIZE = parseInt(process.env.RPC_BATCH_SIZE || 50)
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || 500)

const computeDirectCreationContractAddress = (from, nonce) => {
  const encoded = new Uint8Array(rlp.encode([from, nonce]))
  const hashed = ONEUtil.keccak(encoded)
  return ONEUtil.hexString(hashed.slice(12))
}

const batchGetBalance = async (addresses) => {
  console.log(`Retrieving balances of ${addresses.length} addresses with batch size = ${RPC_BATCH_SIZE}`)
  const chunks = chunk(addresses, RPC_BATCH_SIZE)
  const balances = []
  for (const c of chunks) {
    const b = await Promise.all(c.map(a => api.blockchain.getBalance({ address: a })))
    balances.push(...b)
    await new Promise((resolve) => setTimeout(resolve, SLEEP_BETWEEN_RPC))
  }
  return balances
}

const timeString = timestamp => {
  return moment(timestamp).tz('America/Los_Angeles').format('YYYY-MM-DDTHH:mm:ssZ')
}

const search = async ({ address, target }) => {
  let left = 0; let mid = 1; let right = -1
  while (right < 0 || (left + 1 < right && left !== mid)) {
    console.log(`Binary searching pageIndex`, { left, mid, right })
    const transactions = await api.rpc.getTransactionHistory({ address, pageIndex: mid, pageSize: PAGE_SIZE, fullTx: false })
    const h = transactions[transactions.length - 1]
    if (!h) {
      right = mid
      mid = Math.floor((left + right) / 2)
      continue
    }
    const { timestamp } = await api.rpc.getTransaction(h)
    const t = new BN(timestamp.slice(2), 16).toNumber() * 1000
    if (t <= target) {
      right = mid
      mid = Math.floor((left + right) / 2)
    } else {
      left = mid
      if (right < 0) {
        mid *= 2
      } else {
        mid = Math.floor((left + right) / 2)
      }
    }
  }
  return left
}
// TODO: add a binary search function to jump pageIndex to <to>
const scan = async ({ address, from = T0, to = Date.now(), retrieveBalance = true }) => {
  let pageIndex = await search({ address, target: to })
  let tMin = to
  console.log({ from, to })
  const wallets = []
  while (tMin > from) {
    const transactions = await api.rpc.getTransactionHistory({ address, pageIndex, pageSize: PAGE_SIZE, fullTx: true })
    if (!transactions || transactions.length === 0) {
      console.log(`Out of data at page ${pageIndex}; Exiting transaction history query loop`)
      tMin = from
      break
    }
    // console.log(transactions)
    tMin = Math.min(tMin, min(transactions.map(t => new BN(t.timestamp.slice(2), 16).toNumber() * 1000)))
    const creations = transactions.filter(e => e.input.startsWith('0x60806040'))
    console.log(`Searched transaction history down to time = ${timeString(tMin)}; at page ${pageIndex}; retrieved ${transactions.length} transactions from relayer; ${creations.length} creations of 1wallet`)

    creations.forEach((t) => {
      const { timestamp, nonce } = t
      const time = timestamp * 1000
      if (time < from) {
        return
      }
      wallets.push({ address: computeDirectCreationContractAddress(nonce), creationTime: time })
    })
    pageIndex++
    await new Promise((resolve) => setTimeout(resolve, SLEEP_BETWEEN_RPC))
  }
  const uniqueWallets = uniqBy(wallets, w => w.address)
  const balances = retrieveBalance && await batchGetBalance(uniqueWallets.map(w => w.address))
  return { balances, wallets: uniqueWallets }
}

async function exec () {
  const fp = await fs.open(STATS_CACHE, 'a+')
  const fp2 = await fs.open(ADDRESSES_CACHE, 'w+')
  const stats = JSON.parse((await fs.readFile(STATS_CACHE, { encoding: 'utf-8' }) || '{}'))
  const now = Date.now()
  const updateBalance = now - (stats.lastBalanceUpdate || 0) >= MAX_BALANCE_AGE
  const from = stats.lastScanTime || 0
  let totalBalance = new BN(stats.totalBalance)
  let totalAddresses = stats.totalAddresses
  for (const address of RELAYER_ADDRESSES) {
    const { balances, wallets } = await scan({ address, from })
    totalAddresses += wallets.length
    if (balances) {
      totalBalance = totalBalance.add(balances.reduce((r, b) => r.add(new BN(b)), new BN(0)))
      const s = wallets.map((w, i) => `${w.address},${w.creationTime},${balances[i]}`).join('\n')
      await fp2.write(s + '\n')
    }
  }
  const newStats = {
    totalBalance: totalBalance.toString(),
    totalAddresses,
    lastBalanceUpdate: stats.lastBalanceUpdate,
    lastScanTime: now
  }
  console.log(`writing new stats`, newStats)
  await fp.write(JSON.stringify(newStats), 0, 'utf-8')
}

exec().catch(e => console.error(e))