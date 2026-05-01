import React from 'react'

export default function Skeleton({lines = 3, height = 16}:{lines?: number, height?: number}){
  return (
    <div className="card">
      {Array.from({length: lines}).map((_, i) => (
        <div key={i} className="skeleton" style={{height: height, marginBottom: i === lines-1 ? 0 : 10}} />
      ))}
    </div>
  )
}
