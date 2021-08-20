import React, { useCallback, useEffect, useState } from 'react'
import { Button, Col, Input, Modal, Row, Space, Spin, Typography } from 'antd'
import api from '../api'
import util from '../util'
import ONEUtil from '../../../lib/util'
import { useDispatch, useSelector } from 'react-redux'
import { Warning } from './Text'
import { walletActions } from '../state/modules/wallet'

const { Text, Title } = Typography

const inputStyle = {
  borderWidth: '0 0 2px',
  borderStyle: 'dashed',
  borderColor: '#000000',
  padding: 0,
  textAlign: 'right'
}

const priceRowStyle = {
  textAlign: 'center'
}

const inputRowStyle = {
  paddingBottom: '30px'
}

const WarningTextStyle = {
  textAlign: 'center',
  marginBottom: '20px',
  display: 'block'
}

const minDomainNameLength = 3

const delayCheckMillis = 1300

const oneDomain = '.crazy.one'

const validDomain = (domainName) => {
  try {
    if (domainName.length <= minDomainNameLength) {
      return undefined
    }

    return ONEUtil.normalizeDomain(`${domainName}${oneDomain}`)
  } catch (e) {
    return undefined
  }
}

/**
 * Custom hook that executes a function with delay and cancellation, if the useEffect is destroyed due to the dependencies
 * update, the timeout is cancelled, which cancels the function execution.
 * The function only runs when the supplied condition is true.
 */
const useWaitExecution = (func, runCondition, wait, dependencies) => {
  useEffect(() => {
    let timeout
    if (runCondition) {
      timeout = setTimeout(func, wait)
    }

    return () => {
      clearTimeout(timeout)
    }
  }, dependencies)
}

/**
 * Renders warning message block for the ability to purchase a domain based on the domain availability and balance availability.
 */
const WarningMessageBlock = ({ enoughBalance, domainAvailable, checkingAvailability, validatedDomain }) => (
  <Space direction='vertical' style={WarningTextStyle}>
    {
      !enoughBalance && !checkingAvailability ? <Warning>Not enough ONE balance</Warning> : <></>
    }
    {
      !domainAvailable && !checkingAvailability ? <Warning>Domain is not available</Warning> : <></>
    }
    {
      checkingAvailability && validatedDomain ? <Spin /> : <></>
    }
  </Space>
)

/**
 * Renders a modal that enables users to purchase an available domain for their selected wallet using selected token.
 */
const DomainPurchaseModal = ({ isModalVisible, dismissModal, oneBalance, walletAddress }) => {
  const dispatch = useDispatch()

  const [domainName, setDomainName] = useState('')

  const [purchaseOnePrice, setPurchaseOnePrice] = useState(0)

  const [domainFiatPrice, setDomainFiatPrice] = useState(0)

  const [available, setAvailable] = useState(false)

  const [enoughBalance, setEnoughBalance] = useState(false)

  const [domainAvailable, setDomainAvailable] = useState(false)

  const [checkingAvailability, setCheckingAvailability] = useState(true)

  const price = useSelector(state => state.wallet.price)

  const validatedDomain = validDomain(domainName)

  const purchaseDomain = useCallback(async () => {
    // The validated domain will be sent as [selectedDomainName].crazy.one.
    dispatch(walletActions.purchaseDomain({ domainName: validatedDomain, address: walletAddress }))
    dismissModal()
  }, [domainName, walletAddress])

  useWaitExecution(
    async () => {
      setCheckingAvailability(true)

      const domainOnePrice = await api.blockchain.domain.price({ name: domainName })

      const domainAvailability = await api.blockchain.domain.available({ name: domainName })

      const computedDomainOnePrice = util.computeBalance(domainOnePrice.toString(), price)

      const hasEnoughBalance = BigInt(domainOnePrice.toString()) <= BigInt(oneBalance)

      const domainAvailableAndValid = domainAvailability && validatedDomain

      setPurchaseOnePrice({ formatted: computedDomainOnePrice.formatted, value: domainOnePrice.toString() })

      setDomainFiatPrice(computedDomainOnePrice.fiatFormatted)

      setEnoughBalance(hasEnoughBalance)

      setDomainAvailable(domainAvailableAndValid)

      setAvailable(domainAvailableAndValid && hasEnoughBalance)

      setCheckingAvailability(false)
    },
    validDomain(domainName),
    delayCheckMillis,
    [domainName, validatedDomain]
  )

  useEffect(() => {
    if (!validatedDomain) {
      setEnoughBalance(false)

      setDomainAvailable(false)

      setAvailable(false)

      setCheckingAvailability(true)

      setPurchaseOnePrice({ formatted: '0', value: '0' })

      setDomainFiatPrice('0')
    }
  }, [validatedDomain, setEnoughBalance, setDomainAvailable, setAvailable, setPurchaseOnePrice, setDomainFiatPrice])

  const onDomainName = (e) => {
    setDomainName(e.target.value)
  }

  return (
    <Modal
      title='Buy Domain'
      visible={isModalVisible}
      onCancel={dismissModal}
      footer={[
        <WarningMessageBlock
          key='error-message'
          enoughBalance={enoughBalance}
          domainAvailable={domainAvailable}
          checkingAvailability={checkingAvailability}
          validatedDomain={validatedDomain}
        />,
        <Button
          key='submit'
          type='primary'
          onClick={purchaseDomain}
          disabled={!available}
        >
          Buy Now
        </Button>
      ]}
    >
      <Row style={inputRowStyle} justify='center'>
        <Col span={6}>
          <Input style={inputStyle} value={domainName} onChange={onDomainName} minLength={minDomainNameLength} />
        </Col>
        <Col span={6}>
          <div style={{}}>
            <Text>{oneDomain}</Text>
          </div>
        </Col>
      </Row>
      <Row style={priceRowStyle} justify='center'>
        <Col span={12}>
          <Title level={4}>Price: {purchaseOnePrice.formatted} ONE</Title>
        </Col>
        <Col span={12}>
          <Title level={4}>
            &#8776; ${domainFiatPrice} <Text type='secondary'>USD</Text>
          </Title>
        </Col>
      </Row>
      <Row justify='center'>
        <Col span={20}>
          <Text type='secondary'>
            Other people can use this domain name to identify your wallet and make transfer. The shorter the name is, the more expensive it would be.
          </Text>
        </Col>
      </Row>
    </Modal>
  )
}

export default DomainPurchaseModal