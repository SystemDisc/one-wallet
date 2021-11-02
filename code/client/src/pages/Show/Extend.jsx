import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { Button, Row, Space, Typography, Input, Col, Radio, Checkbox, Tooltip } from 'antd'
import message from '../../message'
import { CloseOutlined, QuestionCircleOutlined, SnippetsOutlined } from '@ant-design/icons'
import { Hint, InputBox, Label, Warning } from '../../components/Text'
import { AverageRow, TallRow } from '../../components/Grid'
import AddressInput from '../../components/AddressInput'
import { CommitRevealProgress } from '../../components/CommitRevealProgress'
import AnimatedSection from '../../components/AnimatedSection'
import util, { generateOtpSeed, useWindowDimensions } from '../../util'
import BN from 'bn.js'
import ShowUtils from './show-util'
import { useSelector } from 'react-redux'
import { SmartFlows } from '../../../../lib/api/flow'
import ONE from '../../../../lib/onewallet'
import ONEUtil from '../../../../lib/util'
import { api } from '../../../../lib/api'
import ONEConstants from '../../../../lib/constants'
import { OtpStack } from '../../components/OtpStack'
import { useOps } from '../../components/Common'
import QrCodeScanner from '../../components/QrCodeScanner'
import ScanGASteps from '../../components/ScanGASteps'
import {
  buildQRCodeComponent,
  getQRCodeUri, getSecondCodeName,
  OTPUriMode,
  parseMigrationPayload,
  parseOAuthOTP
} from '../../components/OtpTools'
import * as Sentry from '@sentry/browser'
import storage from '../../storage'
import walletActions from '../../state/modules/wallet/actions'
import Paths from '../../constants/paths'
import WalletConstants from '../../constants/wallet'
import WalletCreateProgress from '../../components/WalletCreateProgress'
import qrcode from 'qrcode'
import OtpBox from '../../components/OtpBox'
import { OtpSetup, TwoCodeOption } from '../../components/OtpSetup'
import WalletAddress from '../../components/WalletAddress'
const { Title, Text } = Typography
const { TextArea } = Input

const Subsections = {
  init: 'init', // choose method,
  scan: 'scan', // scan an exported QR code from authenticator
  new: 'new', // use a new authenticator code
  confirm: 'confirm' // authorize with old authenticator code, confirm, finalize; show progress circle
}

const Extend = ({
  address,
  onClose: onCloseOuter,
  show,
}) => {
  const {
    dispatch, wallet, network, stage, setStage,
    resetWorker, recoverRandomness, otpState, isMobile, os
  } = useOps({ address })
  const dev = useSelector(state => state.wallet.dev)
  const { majorVersion, name, expert } = wallet
  const [method, setMethod] = useState()
  const [seed, setSeed] = useState()
  const [seed2, setSeed2] = useState()

  const [section, setSection] = useState(Subsections.init)

  const [root, setRoot] = useState()
  const [effectiveTime, setEffectiveTime] = useState()
  const [hseed, setHseed] = useState()
  const [layers, setLayers] = useState()
  const [doubleOtp, setDoubleOtp] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState(0)
  const securityParameters = ONEUtil.securityParameters(wallet)
  const [computeInProgress, setComputeInProgress] = useState(false)

  const [confirmName, setConfirmName] = useState()

  const [qrCodeData, setQRCodeData] = useState()
  const [secondOtpQrCodeData, setSecondOtpQrCodeData] = useState()

  const [validationOtp, setValidationOtp] = useState()
  const validationOtpRef = useRef()
  const [showSecondCode, setShowSecondCode] = useState()
  const duration = WalletConstants.defaultDuration
  const slotSize = wallet.slotSize

  const reset = () => {
    setHseed(null)
    setRoot(null)
    setLayers(null)
    setEffectiveTime(0)
    setProgressStage(0)
    setProgress(0)
  }
  const onClose = () => {
    reset()
    setSection(Subsections.init)
    setSeed(null)
    setSeed2(null)
    setQRCodeData(null)
    setShowSecondCode(null)
    setSecondOtpQrCodeData(null)
    setConfirmName(null)
    setValidationOtp(null)
    setDoubleOtp(false)
    setMethod(null)
    onCloseOuter()
  }

  useEffect(() => {
    if (!seed || method !== 'new') {
      return
    }
    const f = async function () {
      const otpUri = getQRCodeUri(seed, name, OTPUriMode.MIGRATION)
      const otpQrCodeData = await qrcode.toDataURL(otpUri, { errorCorrectionLevel: 'low', width: isMobile ? 192 : 256 })
      setQRCodeData(otpQrCodeData)
    }
    f()
  }, [name, method, seed])
  useEffect(() => {
    if (!doubleOtp || !seed2 || method !== 'new') {
      return
    }
    const f = async function () {
      const secondOtpUri = getQRCodeUri(seed2, getSecondCodeName(name), OTPUriMode.MIGRATION)
      const secondOtpQrCodeData = await qrcode.toDataURL(secondOtpUri, { errorCorrectionLevel: 'low', width: isMobile ? 192 : 256 })
      setSecondOtpQrCodeData(secondOtpQrCodeData)
    }
    f()
  }, [name, method, seed2, doubleOtp])

  const { prepareValidation, ...handlers } = ShowUtils.buildHelpers({
    setStage,
    otpState,
    network,
    resetWorker,
    onSuccess: () => {
      storage.setItem(root, layers)
      const wallet = {
        _merge: true,
        address,
        root,
        duration,
        effectiveTime,
        hseed: ONEUtil.hexView(hseed),
        doubleOtp,
        network,
        ...securityParameters,
      }
      dispatch(walletActions.updateWallet(wallet))
      message.success(`Wallet ${wallet.name} (${address}) expiry date is extended to ${new Date(effectiveTime + duration).toLocaleDateString()}`)
      setTimeout(() => history.push(Paths.showAddress(address)), 1500)
    }
  })

  const doReplace = () => {
    const { otp, otp2, invalidOtp2, invalidOtp } = prepareValidation({
      state: { ...otpState }, checkAmount: false, checkDest: false,
    }) || {}

    // eslint-disable-next-line no-useless-return
    if (invalidOtp || invalidOtp2) return

    if (!root) {
      console.error('Root is not set')
      return
    }

    console.log('TODO')

    // const args = { amount, operationType: ONEConstants.OperationType.CALL, tokenType: ONEConstants.TokenType.NONE, contractAddress: dest, tokenId: 0, dest: ONEConstants.EmptyAddress }
    // SmartFlows.commitReveal({
    //   wallet,
    //   otp,
    //   otp2,
    //   recoverRandomness,
    //   commitHashGenerator: ONE.computeGeneralOperationHash,
    //   commitHashArgs: { ...args, data: ONEUtil.hexStringToBytes(encodedData) },
    //   prepareProof: () => setStage(0),
    //   beforeCommit: () => setStage(1),
    //   afterCommit: () => setStage(2),
    //   revealAPI: api.relayer.reveal,
    //   revealArgs: { ...args, data: encodedData },
    //   ...handlers
    // })
  }

  useEffect(() => {
    if (validationOtp?.length !== 6) {
      return
    }
    const currentSeed = showSecondCode ? seed2 : seed
    const expected = ONEUtil.genOTP({ seed: currentSeed })
    const code = new DataView(expected.buffer).getUint32(0, false).toString()
    setValidationOtp('')
    if (code.padStart(6, '0') !== validationOtp.padStart(6, '0')) {
      message.error('Code is incorrect. Please try again.')
      validationOtpRef?.current?.focusInput(0)
    } else if (doubleOtp && !showSecondCode) {
      setShowSecondCode(true)
      validationOtpRef?.current?.focusInput(0)
    } else {
      setSection(Subsections.confirm)
    }
  }, [validationOtp])

  useEffect(() => {
    if (!seed) {
      return
    }
    const worker = new Worker('/ONEWalletWorker.js')
    const effectiveTime = Date.now()
    const salt = ONEUtil.hexView(generateOtpSeed())
    worker.onmessage = (event) => {
      const { status, current, total, stage, result, salt: workerSalt } = event.data
      if (workerSalt && workerSalt !== salt) {
        // console.log(`[Extend] Discarding outdated worker result (salt=${workerSalt}, expected=${salt})`)
        return
      }
      if (status === 'working') {
        setProgress(Math.round(current / total * 100))
        setProgressStage(stage)
      }
      if (status === 'done') {
        const { hseed, root, layers, doubleOtp } = result
        setHseed(hseed)
        setRoot(root)
        setLayers(layers)
        setDoubleOtp(doubleOtp)
        setEffectiveTime(effectiveTime)
        setComputeInProgress(false)
      }
    }
    console.log('[Extend] Posting to worker')
    worker && worker.postMessage({
      seed,
      salt,
      seed2: doubleOtp && seed2,
      effectiveTime,
      duration,
      slotSize,
      interval: WalletConstants.interval,
      ...securityParameters
    })
    setComputeInProgress(true)
  }, [seed, method, doubleOtp])

  useEffect(() => {
    reset()
    if (method === 'new') {
      setSeed(generateOtpSeed())
      setSeed2(generateOtpSeed())
      setSection(Subsections.new)
    } else if (method === 'scan') {
      setSeed(null)
      setSeed2(null)
      setSection(Subsections.scan)
    }
  }, [method])

  const onScan = (e) => {
    if (e && !seed) {
      try {
        let parsed
        if (e.startsWith('otpauth://totp')) {
          parsed = parseOAuthOTP(e)
        } else {
          parsed = parseMigrationPayload(e)
        }

        if (!parsed) {
          return
        }
        console.log(parsed)
        const { secret2, secret, name } = parsed
        setSeed(secret)
        if (secret2) {
          setSeed2(secret2)
          setDoubleOtp(true)
        }
        if (name !== wallet.name) {
          setConfirmName(name)
          return
        }
        setSection(Subsections.confirm)
      } catch (ex) {
        Sentry.captureException(ex)
        console.error(ex)
        message.error(`Failed to parse QR code. Error: ${ex.toString()}`)
      }
    }
  }
  const confirmUseName = () => {
    setSection(Subsections.confirm)
  }
  const cancelUseName = () => {
    setConfirmName(null)
    setSeed(null)
    setSeed2(null)
  }

  const Subsection = useCallback(({ show, children }) => {
    return (
      <AnimatedSection
        show={show} title={
          <Space direction='vertical'>
            <Title level={3}>Extend Wallet Life</Title>
            <WalletAddress showLabel alwaysShowOptions address={address} addressStyle={{ padding: 0 }} />
          </Space>
}
      >
        {children}
        <Row justify='start' style={{ marginTop: 48 }}>
          <Button size='large' type='link' onClick={onClose} danger style={{ padding: 0 }}>Cancel</Button>
        </Row>
      </AnimatedSection>
    )
  }, [address])

  if (!show) {
    return <></>
  }

  if (majorVersion < 14) {
    console.log(majorVersion, name)
    return (
      <Subsection show onClose={onClose}>
        <Warning>Your wallet is too old. Please use a wallet that is at least version 14.1</Warning>
      </Subsection>
    )
  }

  return (
    <>
      <Subsection onClose={onClose} show={section === Subsections.init}>
        <AverageRow>
          <Title level={3}>Set up a new authenticator code?</Title>
        </AverageRow>
        <AverageRow gutter={24}>
          <Col span={isMobile ? 24 : 12}>
            <Space direction='vertical' size='large' style={{ width: '100%' }} align='center'>
              <Button shape='round' type='primary' onClick={() => setMethod('scan')}>Use the same</Button>
              <Hint>You will need to export the Google Authenticator QR Code and scan it using a camera</Hint>
            </Space>
          </Col>
          <Col span={isMobile ? 24 : 12}>
            <Space direction='vertical' size='large' style={{ width: '100%' }} align='center'>
              <Button shape='round' type='primary' onClick={() => setMethod('new')}>Setup a new one</Button>
              <Hint>You will scan a new QR code for your authenticator. Your old authenticator code will no longer work.</Hint>
            </Space>
          </Col>
        </AverageRow>
      </Subsection>
      <Subsection onClose={onClose} show={section === Subsections.scan}>
        {!confirmName &&
          <Space direction='vertical'>
            <ScanGASteps />
            <QrCodeScanner shouldInit={section === Subsections.scan} onScan={onScan} />
          </Space>}
        {confirmName &&
          <Space direction='vertical'>
            <AverageRow>
              <Text>You scanned a code for wallet <b>{confirmName}</b>, but your wallet's name is <b>{wallet.name}</b>. This means you might have scanned the wrong code.</Text>
            </AverageRow>
            <AverageRow>
              <Text style={{ color: 'red' }}> Are you sure to use this code from now on for this wallet?</Text>
            </AverageRow>
            <AverageRow justify='space-between'>
              <Button shape='round' onClick={cancelUseName}>Scan again</Button>
              <Button shape='round' type='primary' onClick={confirmUseName}>Yes, I understand</Button>
            </AverageRow>
          </Space>}

      </Subsection>
      <Subsection onClose={onClose} show={section === Subsections.new}>
        <Space direction='vertical' align='center' style={{ width: '100%' }}>
          <Hint>Scan or tap the QR code to setup a new authenticator code</Hint>
          {!showSecondCode &&
            <>
              {buildQRCodeComponent({ seed, name, os, isMobile, qrCodeData })}
              <OtpSetup isMobile={isMobile} otpRef={validationOtpRef} otpValue={validationOtp} setOtpValue={setValidationOtp} name={name} />
              {(dev || expert) && <TwoCodeOption isMobile={isMobile} setDoubleOtp={setDoubleOtp} doubleOtp={doubleOtp} />}
            </>}
          {showSecondCode &&
            <>
              {buildQRCodeComponent({ seed, name, os, isMobile, qrCodeData: secondOtpQrCodeData })}
              <OtpSetup isMobile={isMobile} otpRef={validationOtpRef} otpValue={validationOtp} setOtpValue={setValidationOtp} name={getSecondCodeName(name)} />
            </>}
        </Space>
      </Subsection>
      <Subsection onClose={onClose} show={section === Subsections.confirm}>
        <AverageRow>
          <Hint>If you have this wallet on other devices, they will no longer work. To continue using the wallet there, open the wallet on those devices, follow the instructions, delete and "Restore" the wallet there. </Hint>
        </AverageRow>
        <AverageRow>
          {method === 'new' &&
            <Text style={{ color: 'red' }}>
              Confirm that you want to replace your authenticator code (using your old code). After this is completed, remember to test and make sure the new code works before deleting the old code!
            </Text>}
        </AverageRow>
        {!root && <WalletCreateProgress title='Computing security parameters...' progress={progress} isMobile={isMobile} progressStage={progressStage} />}
        <AverageRow align='middle'>
          <Col span={24}>
            <OtpStack
              isDisabled={!root}
              walletName={wallet.name}
              otpState={otpState}
              onComplete={doReplace}
              action={`confirm ${method === 'new' ? '(using old authenticator code)' : ''}`}
            />
          </Col>
        </AverageRow>
        <CommitRevealProgress stage={stage} style={{ marginTop: 32 }} />
      </Subsection>
    </>

  )
}

export default Extend