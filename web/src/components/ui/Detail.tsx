import React from 'react'
import { useDetailed } from '../../stores/viewModeStore'

/** '자세히' 보기일 때만 내용을 그린다. 간단히 보기에서는 아무것도 남기지 않는다 */
export default function Detail({ children }: { children: React.ReactNode }) {
  return useDetailed() ? <>{children}</> : null
}
