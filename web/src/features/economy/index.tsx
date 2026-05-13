import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function EconomyPage() {
  const navigate = useNavigate()
  useEffect(() => { navigate('/market', { replace: true }) }, [navigate])
  return null
}
