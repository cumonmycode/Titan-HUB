'use client'
import React from 'react'

// Знак Tai «Аура» — стеклянная сфера, внутри которой переливается свет (как в приложении HUB).
//  • animated=true  — свет внутри медленно кружит (шапка, пустой экран, кнопки навигации);
//  • animated=false — неподвижная сфера (аватарки у сообщений — без десятков анимаций);
//  • thinking=true  — свет кружит быстро, сфера «дышит» (индикатор работы);
//  • float — плавное парение вверх-вниз (выключаем в навигации и индикаторах);
//  • glow — мягкий фиолетовый ореол.
// Стили — в globals.css (.tai-aura…). Уважает prefers-reduced-motion.

export function TaiLogo({
  size = 40, animated = true, thinking = false, float = true, glow = true,
}: { size?: number; animated?: boolean; thinking?: boolean; float?: boolean; glow?: boolean }) {
  const classes = ['tai-aura', glow && 'has-glow', animated && float && 'is-float', animated && thinking && 'is-thinking']
    .filter(Boolean)
    .join(' ')
  const style = { width: size, height: size, '--tai-size': `${size}px`, '--tai-spin': thinking ? '2.2s' : '9s' } as React.CSSProperties
  return (
    <span className={classes} style={style} aria-hidden="true">
      <span className="tai-aura-core">
        <span className={animated ? 'tai-aura-light is-live' : 'tai-aura-light'} />
      </span>
    </span>
  )
}
