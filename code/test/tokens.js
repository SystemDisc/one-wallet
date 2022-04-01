const TestUtil = require('./util')
const config = require('../config')
const unit = require('ethjs-unit')
const ONEUtil = require('../lib/util')
const ONEConstants = require('../lib/constants')
const ONE = require('../lib/onewallet')
const ONEWallet = require('../lib/onewallet')
const BN = require('bn.js')
const ONEDebugger = require('../lib/debug')
const assert = require('assert')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')
const TestERC1155 = artifacts.require('TestERC1155')

const NullOperationParams = {
  ...ONEConstants.NullOperationParams,
  data: new Uint8Array()

}
const INTERVAL = 30000 // 30 second Intervals
const DURATION = INTERVAL * 12 // 6 minute wallet duration
// const SLOT_SIZE = 1 // 1 transaction per interval
const EFFECTIVE_TIME = Math.floor(Date.now() / INTERVAL / 6) * INTERVAL * 6 - DURATION / 2
const DUMMY_HEX = '0x'

const Logger = {
  debug: (...args) => {
    if (config.verbose) {
      console.log(...args)
    }
  }
}
const Debugger = ONEDebugger(Logger)

// === UTILITY FUNCTIONS
// makeTokens makes test ERC20, ERC20Decimals9, ERC721, ERC1155
const makeTokens = async ({
  deployer,
  makeERC20 = true,
  makeERC721 = true,
  makeERC1155 = true,
  fund = true,
  validate = true
}) => {
  let testerc20
  let testerc721
  let testerc1155
  // create an ERC20
  if (makeERC20) { testerc20 = await TestERC20.new(10000000, { from: deployer }) }
  // create an ERC721
  if (makeERC721) {
    const tids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const uris = tids.map(e => `ipfs://test721/${e}`)
    testerc721 = await TestERC721.new(tids, uris, { from: deployer })
  }
  // create an ERC1155
  if (makeERC1155) {
    const tids1155 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const amounts1155 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const uris1155 = tids1155.map(e => `ipfs://test1155/${e}`)
    testerc1155 = await TestERC1155.new(tids1155, amounts1155, uris1155, { from: deployer })
  }
  return { testerc20, testerc721, testerc1155 }
}

// fundTokens
// funder: address (must have tokens and be unlocked for signing)
// receiver: address
const fundTokens = async ({
  funder,
  receivers = [],
  tokenTypes = [],
  tokenContracts = [],
  tokenAmounts = [[]],
  tokenIds = [[]],
  validate = true
}) => {
  // let balances[]
  // let tids[]
  // transfer ERC20 tokens from accounts[0] (which owns the tokens) to alices wallet
  for (let i = 0; i < tokenTypes.length; i++) {
    switch (tokenTypes[i]) {
      case ONEConstants.TokenType.ERC20:
        // await testerc20.transfer(alice.wallet.address, 1000, { from: accounts[0] })
        await tokenContracts[i].transfer(receivers[i], tokenAmounts[i][0], { from: funder })
        // balances[i]= await tokenAddresses[i].balanceOf(receiver)
        Logger.debug('FundTokens ERC20')
        break
      case ONEConstants.TokenType.ERC721:
        for (let j = 0; j < tokenIds[i].length; j++) {
          await tokenContracts[i].safeTransferFrom(funder, receivers[i], tokenIds[i][j], { from: funder })
        }
        Logger.debug('FundTokens ERC721')
        break
      case ONEConstants.TokenType.ERC1155:
        for (let j = 0; j < tokenIds[i].length; j++) {
          await tokenContracts[i].safeTransferFrom(funder, receivers[i], tokenIds[i][j], tokenAmounts[i][j], DUMMY_HEX, { from: funder })
        }
        Logger.debug('FundTokens ERC1155')
        break
      default:
        console.log(`ERROR fundTokens: Index ${[i]} Incorrect TokenType:  ${tokenTypes[i]}`)
        return
    }
  }
  if (validate) validatetokenBalances({ receivers, tokenTypes, tokenContracts, tokenAmounts, tokenIds })
  // return {balances, tids}
}

// ==== EXECUTION FUNCTIONS ====
// executeStandardTransaction commits and reveals a wallet transaction
const executeTokenTransaction = async ({
  walletInfo,
  operationType,
  tokenType,
  contractAddress,
  tokenId,
  dest,
  amount,
  data,
  address,
  randomSeed,
  testTime = Date.now(),
  getCurrentState = true
}) => {
  // // calculate counter from testTime
  const counter = Math.floor(testTime / INTERVAL)
  const otp = ONEUtil.genOTP({ seed: walletInfo.seed, counter })
  // // calculate wallets effectiveTime (creation time) from t0
  const info = await walletInfo.wallet.getInfo()
  const t0 = new BN(info[3]).toNumber()
  const walletEffectiveTime = t0 * INTERVAL
  const index = ONEUtil.timeToIndex({ effectiveTime: walletEffectiveTime, time: testTime })
  const eotp = await ONE.computeEOTP({ otp, hseed: walletInfo.hseed })

  // Format commit and revealParams
  let paramsHash = ONEWallet.computeGeneralOperationHash
  let commitParams = { operationType, tokenType, contractAddress, tokenId, dest, amount, data }
  let revealParams = { operationType, tokenType, contractAddress, tokenId, dest, amount, data }
  let { tx, authParams, revealParams: returnedRevealParams } = await TestUtil.commitReveal({
    Debugger,
    layers: walletInfo.layers,
    index,
    eotp,
    paramsHash,
    commitParams,
    revealParams,
    wallet: walletInfo.wallet
  })
  let currentState
  if (getCurrentState) { currentState = await TestUtil.getONEWalletState(walletInfo.wallet) }
  return { tx, authParams, revealParams: returnedRevealParams, currentState }
}

// ==== Validation Helpers ====
const validatetokenBalances = async ({
  receivers = [],
  tokenTypes = [],
  tokenContracts = [],
  tokenIds = [[]],
  tokenAmounts = [[]]
}) => {
  for (let i = 0; i < tokenTypes.length; i++) {
    switch (tokenTypes[i]) {
      case ONEConstants.TokenType.ERC20:
        let balanceERC20 = await tokenContracts[i].balanceOf(receivers[i])
        assert.strictEqual(tokenAmounts[i][0].toString(), balanceERC20.toString(), 'Should have transferred ERC20 tokens to wallet')
        break
      case ONEConstants.TokenType.ERC721:
        for (let j = 0; j < tokenIds[i].length; j++) {
          let balanceERC721 = await tokenContracts[i].balanceOf(receivers[i])
          assert.strictEqual(tokenAmounts[i].toString(), balanceERC721.toString(), 'Transfer of ERC721 token to receiver validated by balance')
          let owner = await tokenContracts[i].ownerOf(tokenIds[i][j])
          assert.strictEqual(receivers[i], owner, 'Transfer of ERC721 token validated by owner')
        }
        break
      case ONEConstants.TokenType.ERC1155:
        for (let j = 0; j < tokenIds[i].length; j++) {
          let balanceERC1155 = await tokenContracts[i].balanceOf(receivers[i], tokenIds[i][j])
          assert.strictEqual(tokenAmounts[i][j].toString(), balanceERC1155.toString(), 'ERC1155 token to balance validated')
          // assert.strictEqual(tokenAmounts[i][j], await tokenContracts[i].balanceOf(receivers[i], tokenContracts[i][j]), 'Transfer of ERC1155 token to receiver validated by balance')
        }
        break
      default:
        Logger.debug(`ERROR validatetokenBalances: Index ${[i]} Incorrect TokenType:  ${tokenTypes[i]}`)
    }
  }
}

const updateOldTrackedTokens = async ({
  expectedTrackedTokens,
  wallet
}) => {
  let trackedTokens = await wallet.getTrackedTokens()
  Logger.debug(`expectedTrackedTokens: ${JSON.stringify(expectedTrackedTokens)}`)
  Logger.debug(`trackedTokens: ${JSON.stringify(trackedTokens)}`)
  // expectedTrackedTokens.sort()
  let expectedTokenTypes = expectedTrackedTokens[0].sort()
  let expectedContractAddresses = expectedTrackedTokens[1].sort()
  let expectedTokenIds = expectedTrackedTokens[2].sort()
  let trackedTokenArray = Object.values(trackedTokens).slice()
  // trackedTokenArray.sort()
  let trackedTokenTypes = trackedTokenArray[0].slice()
  trackedTokenTypes.sort()
  let trackedTokenContractAddresses = trackedTokenArray[1].slice()
  trackedTokenContractAddresses.sort()
  let trackedTokenTokenIds = trackedTokenArray[2].slice()
  trackedTokenTokenIds.sort()
  assert.strictEqual(expectedTokenTypes.length, trackedTokenTypes.length, 'Number of Tracked Tokens is different than expected')
  for (let i = 0; i < trackedTokens[0].length; i++) {
    assert.strictEqual(expectedTokenTypes[i].toString(), trackedTokenTypes[i].toString(), 'Tracked Token Type is different than expected')
    assert.strictEqual(expectedContractAddresses[i].toString(), trackedTokenContractAddresses[i].toString(), 'Tracked Token Address is different than expected')
    assert.strictEqual(expectedTokenIds[i].toString(), trackedTokenTokenIds[i].toString(), 'Tracked Token Ids are different than expected')
  }
  return trackedTokens
}

// === TESTING
contract('ONEWallet', (accounts) => {
  // Wallets effective time is the current time minus half the duration (3 minutes ago)
  let snapshotId
  beforeEach(async function () {
    snapshotId = await TestUtil.snapshot()
    await TestUtil.init()
  })
  afterEach(async function () {
    await TestUtil.revert(snapshotId)
  })

  // === BASIC POSITIVE TESTING ERC20 ====

  // ====== TRACK ======
  // Test tacking of an ERC20 token
  // Expected result the token is now tracked
  it('TN.BASIC.0 TRACK: must be able to track ERC20 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.BASIC.0.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTracked' })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC20], [testerc20.address], [[0]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // ====== UNTRACK ======
  // Test untracking of an ERC20 token
  // Expected result the token is no longer tracked
  it('TN.BASIC.1 UNTRACK: must be able to untrack ERC20 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.BASIC.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    // Need to track a token before untracking
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        testTime
      }
    )
    // Update alice current State
    aliceOldState = aliceCurrentStateTracked

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    // eslint-disable-next-line no-lone-blocks
    let { tx, currentState: aliceCurrentStateUntracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.UNTRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenUntracked' })

    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[], [], [[]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateUntracked)
  })

  // ====== TRANSFER_TOKEN ======
  // Test transferring a token
  // Expected result the token is now tracked and alices balance has decreased and bobs increased
  it('TN.BASIC.2 TRANSFER_TOKEN: must be able to transfer ERC20 token', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.2.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    let { walletInfo: bob } = await TestUtil.makeWallet({ salt: 'TN.BASIC.2.2', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })

    // make Tokens
    const { testerc20 } = await makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()
    // Fund Alice with 1000 ERC20 tokens
    await fundTokens({
      funder: accounts[0],
      receivers: [alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC20],
      tokenContracts: [testerc20],
      tokenAmounts: [[1000]]
    })

    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceTransferState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: bob.wallet.address,
        amount: 100,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTransferSucceeded' })

    // check alice and bobs balance

    await validatetokenBalances({
      receivers: [alice.wallet.address, bob.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC20],
      tokenContracts: [testerc20, testerc20],
      tokenAmounts: [[900], [100]]
    })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC20], [testerc20.address], [[0]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })

    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceTransferState)
  })

  // ====== OVERRIDE_TRACK ======
  // Test overriding all of Alices Token Tracking information
  // Expected result: Alice will now track testerc20v2 instead of testerc20
  it('TN.BASIC.3 OVERRIDE_TRACK: must be able to override ERC20 tracked tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.3.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })
    const { testerc20: testerc20v2 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    // First track testerc20
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: alice.wallet.address,
        amount: 1,
        testTime
      }
    )

    // Update alice old state to current state (no validation)
    aliceOldState = aliceCurrentStateTracked

    // Get alices current tracked tokens and override the address from testerc20 to testerc20v2
    let newTrackedTokens = await alice.wallet.getTrackedTokens()
    newTrackedTokens[1] = [testerc20v2.address]
    let hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [newTrackedTokens[0], newTrackedTokens[1], newTrackedTokens[2]])
    let data = ONEUtil.hexStringToBytes(hexData)
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTrackedOverride } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.OVERRIDE_TRACK,
        data,
        testTime
      }
    )
    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC20], [testerc20v2.address], [[0]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateTrackedOverride)
  })

  // ==== ADDITIONAL POSITIVE TESTING ERC721 ====

  // ====== TRACK ======
  // Test tacking of an ERC721 token
  // Expected result the token is now tracked
  it('TN.POSITIVE.0 TRACK: must be able to track ERC721 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.0.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc721 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: true, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 3,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTracked' })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC721], [testerc721.address], [[3]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // ====== UNTRACK ======
  // Test untracking of an ERC721 token
  // Expected result the token is no longer tracked
  it('TN.POSITIVE.1 UNTRACK: must be able to untrack ERC721 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc721 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: true, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    // Need to track a token before untracking
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 3,
        testTime
      }
    )
    // Update alice current State
    aliceOldState = aliceCurrentStateTracked

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    // eslint-disable-next-line no-lone-blocks
    let { tx, currentState: aliceCurrentStateUntracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.UNTRACK,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 3,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenUntracked' })

    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[], [], [[]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateUntracked)
  })

  // ====== TRANSFER_TOKEN ======
  // Test transferring a ERC721 token
  // Expected result the token is now tracked and alices balance has decreased and bobs increased
  it('TN.POSITIVE.2 TRANSFER_TOKEN: must be able to transfer ERC721 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.2.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    let { walletInfo: bob } = await TestUtil.makeWallet({ salt: 'TN.BASIC.2.2', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })

    // make Tokens
    const { testerc721 } = await makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: true, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()
    // Fund Alice with 2 ERC721 TOKENS (2,3)
    await fundTokens({
      funder: accounts[0],
      receivers: [alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC721],
      tokenContracts: [testerc721],
      tokenIds: [[2, 3]],
      tokenAmounts: [[2]]
    })
    // let aliceFundedState = await TestUtil.getONEWalletState(alice.wallet)

    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceTransferState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        dest: bob.wallet.address,
        tokenId: 3,
        amount: 1,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTransferSucceeded' })

    // check alice and bobs balance

    await validatetokenBalances({
      receivers: [alice.wallet.address, bob.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC721],
      tokenContracts: [testerc721, testerc721],
      tokenIds: [[2], [3]],
      tokenAmounts: [[1], [1]]
    })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC721], [testerc721.address, testerc721.address], ['2', '3']]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })

    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceTransferState)
  })

  // ====== OVERRIDE_TRACK ======
  // Test overriding all of Alices Token Tracking information
  // Expected result: Alice will now track testerc721v2 instead of testerc721
  it('TN.POSITIVE.3 OVERRIDE_TRACK: must be able to override tracked tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.3.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc721 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: true, makeERC1155: false })
    const { testerc721: testerc721v2 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: true, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    // First track testerc20
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 2,
        dest: alice.wallet.address,
        amount: 1,
        testTime
      }
    )
    // Update alice old state to current state (no validation)
    aliceOldState = aliceCurrentStateTracked

    // Get alices current tracked tokens and override the address from testerc20 to testerc20v2
    let newTrackedTokens = await alice.wallet.getTrackedTokens()
    newTrackedTokens[1] = [testerc721v2.address]
    newTrackedTokens[2] = [3]
    let hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [newTrackedTokens[0], newTrackedTokens[1], newTrackedTokens[2]])
    let data = ONEUtil.hexStringToBytes(hexData)
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTrackedOverride } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.OVERRIDE_TRACK,
        data,
        testTime
      }
    )
    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC721], [testerc721v2.address], [[3]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateTrackedOverride)
  })

  // ==== ADDITIONAL POSITIVE TESTING ERC1155 ====

  // ====== TRACK ======
  // Test tacking of an ERC1155 token
  // Expected result the token is now tracked
  it('TN.POSITIVE.0.1 TRACK: must be able to track ERC1155 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.0.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc1155 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: false, makeERC1155: true })

    // Begin Tests
    let testTime = Date.now()

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 3,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTracked' })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC1155], [testerc1155.address], [[3]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // ====== UNTRACK ======
  // Test untracking of an ERC1155 token
  // Expected result the token is no longer tracked
  it('TN.POSITIVE.1.1 UNTRACK: must be able to untrack ERC1155 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc1155 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: false, makeERC1155: true })

    // Begin Tests
    let testTime = Date.now()

    // Need to track a token before untracking
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 3,
        testTime
      }
    )
    // Update alice current State
    aliceOldState = aliceCurrentStateTracked

    testTime = await TestUtil.bumpTestTime(testTime, 60)
    // eslint-disable-next-line no-lone-blocks
    let { tx, currentState: aliceCurrentStateUntracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.UNTRACK,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 3,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenUntracked' })

    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[], [], [[]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateUntracked)
  })

  // ====== TRANSFER_TOKEN ======
  // Test transferring a ERC1155 token
  // Expected result the token is now tracked and alices balance has decreased and bobs increased
  it('TN.POSITIVE.2.1 TRANSFER_TOKEN: must be able to transfer ERC1155 tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.2.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    let { walletInfo: bob } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.2.1.2', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })

    // make Tokens
    const { testerc1155 } = await makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: false, makeERC1155: true })

    // Begin Tests
    let testTime = Date.now()
    // Fund Alice with 2 ERC1155 tokens (2,3) quantity 20, 30
    await fundTokens({
      funder: accounts[0],
      receivers: [alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC1155],
      tokenContracts: [testerc1155],
      tokenIds: [[2, 3]],
      tokenAmounts: [[20, 30]]
    })
    // let aliceFundedState = await TestUtil.getONEWalletState(alice.wallet)

    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceTransferState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        dest: bob.wallet.address,
        tokenId: 3,
        amount: 30,
        testTime
      }
    )

    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTransferSucceeded' })

    // check alice and bobs balance

    await validatetokenBalances({
      receivers: [alice.wallet.address, bob.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC1155, ONEConstants.TokenType.ERC1155],
      tokenContracts: [testerc1155, testerc1155],
      tokenIds: [[2], [3]],
      tokenAmounts: [[20], [30]]
    })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC1155, ONEConstants.TokenType.ERC1155], [testerc1155.address, testerc1155.address], ['2', '3']]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })

    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceTransferState)
  })

  // ====== OVERRIDE_TRACK ======
  // Test overriding all of Alices Token Tracking information
  // Expected result: Alice will now track testerc1155v2 instead of testerc1155
  it('TN.POSITIVE.3.1 OVERRIDE_TRACK: must be able to override tracked tokens', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.POSITIVE.3.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc1155 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: false, makeERC1155: true })
    const { testerc1155: testerc1155v2 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: false, makeERC721: false, makeERC1155: true })

    // Begin Tests
    let testTime = Date.now()

    // First track testerc20
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 2,
        dest: alice.wallet.address,
        testTime
      }
    )
    // Update alice old state to current state (no validation)
    aliceOldState = aliceCurrentStateTracked

    // Get alices current tracked tokens and override the address from testerc20 to testerc20v2
    let newTrackedTokens = await alice.wallet.getTrackedTokens()
    newTrackedTokens[1] = [testerc1155v2.address]
    newTrackedTokens[2] = [3]
    let hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [newTrackedTokens[0], newTrackedTokens[1], newTrackedTokens[2]])
    let data = ONEUtil.hexStringToBytes(hexData)
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTrackedOverride } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.OVERRIDE_TRACK,
        data,
        testTime
      }
    )
    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC1155], [testerc1155v2.address], [[3]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentStateTrackedOverride)
  })

  // === Negative Use Cases (Event Testing) ===
  // TN.EVENTS.0 TRACK:
  // TN.EVENTS.1 UNTRACK.TokenNotFound: error when untracking a token that hasn't been tracked
  it('TN.EVENTS.1 UNTRACK.TokenNotFound: error when untracking an ERC20 tokens that is not tracked', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.EVENT.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })
    const { testerc20: testerc20v2 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()

    // First track testerc20
    testTime = await TestUtil.bumpTestTime(testTime, 60)
    let { currentState: aliceCurrentStateTracked } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        testTime
      }
    )
    aliceOldState = aliceCurrentStateTracked
    // Begin Tests
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.UNTRACK,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20v2.address,
        testTime
      }
    )

    // TestUtil.validateEvent({ tx, expectedEvent: 'TokenNotFound' })

    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: false })
    // check alice nothing has changed as transction failed
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // TN.EVENTS.2 TOKEN_TRANSFER.TokenTransferError: error when transfer fails
  // Test transferring a token should fail and an event is triggered
  // Expected result the token is now tracked and alices balance has decreased and bobs increased
  it('TN.EVENTS.2 TRANSFER_TOKEN: must be able to transfer ERC20 token', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.EVENTS.2.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    let { walletInfo: bob } = await TestUtil.makeWallet({ salt: 'TN.EVENTS.2.2', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })

    // make Tokens
    const { testerc20 } = await makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: false, makeERC1155: false })

    // Begin Tests
    let testTime = Date.now()
    // Fund Alice with 1000 ERC20 tokens
    await fundTokens({
      funder: accounts[0],
      receivers: [alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC20],
      tokenContracts: [testerc20],
      tokenAmounts: [[1000]]
    })

    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceTransferState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: bob.wallet.address,
        amount: 1500,
        testTime
      }
    )

    // Validate error event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTransferError' })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })

    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceTransferState)
  })
  // TN.EVENTS.3 OVERRIDE_TRACK:

  // === Scenario (Complex) Testing ===

  // TN.COMPLEX.0 TRACK.MultiTrack
  // Test tracking multiple different token types in one call
  it('TN.COMPLEX.0 TRACK.MultiTrack: mulitple tokens tracked', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.COMPLEX.0', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20, testerc721, testerc1155 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: true, makeERC1155: true })

    // create mutiple operations to track ERC20, ERC721 and ERC1155
    const tokenTypes = [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC1155]
    const contractAddresses = [testerc20.address, testerc721.address, testerc1155.address]
    const tokenIds = [0, 2, 3]
    // encode them in data
    let hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [tokenTypes, contractAddresses, tokenIds])
    let data = ONEUtil.hexStringToBytes(hexData)
    // Begin Tests
    let testTime = Date.now()
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        data,
        testTime
      }
    )

    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTracked' })
    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: true })
    // tracked tokens
    const expectedTrackedTokens = [tokenTypes, contractAddresses, tokenIds]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // TN.COMPLEX.1 UNTRACK.multiUntrack
  it('TN.COMPLEX.1 UNTRACK.multiUntrack: mulitple tokens untracked', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TN.EVENT.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    // make Tokens
    const { testerc20, testerc721, testerc1155 } = await TestUtil.makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: true, makeERC1155: true })

    // create mutiple operations to track ERC20, ERC721 and ERC1155
    let tokenTypes = [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC1155]
    let contractAddresses = [testerc20.address, testerc721.address, testerc1155.address]
    let tokenIds = [0, 2, 3]
    // encode them in data
    let hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [tokenTypes, contractAddresses, tokenIds])
    let data = ONEUtil.hexStringToBytes(hexData)
    // Begin Tests
    let testTime = Date.now()
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRACK,
        data,
        testTime
      }
    )

    // create mutiple operations to untrack ERC20, and ERC1155
    tokenTypes = [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC1155]
    contractAddresses = [testerc20.address, testerc1155.address]
    tokenIds = [0, 3]
    // encode them in data
    hexData = ONEUtil.abi.encodeParameters(['uint256[]', 'address[]', 'uint256[]'], [tokenTypes, contractAddresses, tokenIds])
    data = ONEUtil.hexStringToBytes(hexData)

    testTime = await TestUtil.bumpTestTime(testTime, 60)

    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.UNTRACK,
        data,
        testTime
      }
    )

    TestUtil.validateEvent({ tx, expectedEvent: 'TokenUntracked' })
    // Alice Items that have changed - lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState, validateNonce: true })
    // tracked tokens
    const expectedTrackedTokens = [[ONEConstants.TokenType.ERC721], [testerc721.address], [[2]]]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })
    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })

  // Combination testing of multiple tokens, funding, tracking and transfers
  it('TT.COMBO.1: TokenTracker(token management) must commit and reveal successfully', async () => {
    // create wallets and token contracts used througout the tests
    let { walletInfo: alice, walletOldState: aliceOldState } = await TestUtil.makeWallet({ salt: 'TT.COMBO.1.1', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })
    let { walletInfo: bob } = await TestUtil.makeWallet({ salt: 'TT.COMBO.1.2', deployer: accounts[0], effectiveTime: EFFECTIVE_TIME, duration: DURATION })

    // make Tokens
    const { testerc20, testerc721, testerc1155 } = await makeTokens({ deployer: accounts[0], makeERC20: true, makeERC721: true, makeERC1155: true })
    // Fund Alice with 1000 ERC20 tokens
    await fundTokens({
      funder: accounts[0],
      receivers: [alice.wallet.address, alice.wallet.address, alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC1155],
      tokenContracts: [testerc20, testerc721, testerc1155],
      tokenIds: [[], [2, 3], [2, 3]],
      tokenAmounts: [[1000], [2], [20, 30]]
    })

    let testTime = Date.now()
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    // ERC20 Transfer
    await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: bob.wallet.address,
        amount: 100,
        testTime
      }
    )

    // bump the test time
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    // alice transfers tokens to bob
    await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 3,
        dest: bob.wallet.address,
        testTime
      }
    )

    // bump Test Time
    testTime = await TestUtil.bumpTestTime(testTime, 60)

    // alice transfers tokens to bob
    let { tx, currentState: aliceCurrentState } = await executeTokenTransaction(
      {
        ...NullOperationParams, // Default all fields to Null values than override
        walletInfo: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 3,
        dest: bob.wallet.address,
        amount: 30,
        testTime
      }
    )
    // Validate succesful event emitted
    TestUtil.validateEvent({ tx, expectedEvent: 'TokenTransferSucceeded' })

    // check alice and bobs balance

    await validatetokenBalances({
      receivers: [alice.wallet.address, alice.wallet.address, alice.wallet.address],
      tokenTypes: [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC1155],
      tokenContracts: [testerc20, testerc721, testerc1155],
      tokenIds: [[0], [2], [2]],
      tokenAmounts: [[900], [1], [20]]
    })

    // Alice Items that have changed - nonce, lastOperationTime, commits, trackedTokens
    aliceOldState = await TestUtil.updateOldTxnInfo({ wallet: alice.wallet, oldState: aliceOldState })
    // tracked tokens
    const expectedTrackedTokens = [
      [ONEConstants.TokenType.ERC20, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC721, ONEConstants.TokenType.ERC1155, ONEConstants.TokenType.ERC1155],
      [testerc20.address, testerc721.address, testerc721.address, testerc1155.address, testerc1155.address], 
      ['0', '2', '3', '2', '3']
    ]
    aliceOldState.trackedTokens = await updateOldTrackedTokens({ expectedTrackedTokens, wallet: alice.wallet })

    // check alice
    await TestUtil.checkONEWalletStateChange(aliceOldState, aliceCurrentState)
  })
})
