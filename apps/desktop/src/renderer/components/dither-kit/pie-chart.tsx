"use client"

import type { ReactNode } from "react"
import type { ChartConfig, Margins } from "./chart-context"
import type { BloomInput } from "./dither-paint"
import { PieCanvas } from "./pie-canvas"
import { PolarRoot } from "./polar-root"

// `object` rather than `Record<string, unknown>`: interfaces don't get an
// implicit index signature, so interface-typed rows failed to satisfy the
// generic. Internal layers still index rows through their own Row type.
type Row = object

export type PieChartProps<TData extends Row> = {
  data: TData[]
  config: ChartConfig
  children: ReactNode
  dataKey: string
  nameKey: string
  innerRadius?: number
  margins?: Partial<Margins>
  className?: string
  animate?: boolean
  animationDuration?: number
  replayToken?: number
  bloom?: BloomInput
  bloomOnHover?: boolean
  expandOnHover?: boolean
  fillOnSelection?: boolean
  defaultSelectedDataKey?: string | null
  selectedDataKey?: string | null
  onSelectionChange?: (key: string | null) => void
  onSlicePress?: (key: string) => void
}

/** Composable dither **pie / donut** chart. Compose `<Pie>`, `<Legend>`, … inside. */
export function PieChart<TData extends Row>({ expandOnHover = true, fillOnSelection = false, ...props }: PieChartProps<TData>) {
  const Canvas = fillOnSelection ? SelectionPieCanvas : expandOnHover ? PieCanvas : FixedPieCanvas
  return <PolarRoot chartType="pie" Canvas={Canvas} {...props} />
}

function FixedPieCanvas() {
  return <PieCanvas expandOnHover={false} />
}

function SelectionPieCanvas() {
  return <PieCanvas expandOnHover={false} fillOnSelection />
}
