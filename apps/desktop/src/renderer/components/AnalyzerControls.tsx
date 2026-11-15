import type { DashboardProvider } from "@activityusage/contracts";
import { Button, Label, ListBox, Popover, Select, Tooltip } from "@heroui/react";
import { useState } from "react";
import { formatPeriodLabel, shiftDay, todayDay, type AnalyticsRange, type ProviderScope } from "../personal-analytics";
import {
  CalendarRangeIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DayIcon,
  HistoryIcon,
  ProvidersIcon,
  TrendsIcon
} from "../icons";
import { ProviderLogo } from "./ProviderLogo";

interface TimeNavigatorProps {
  backgroundActivity?: React.ReactNode;
  label: string;
  mode: "day" | "range";
  selectedDay: string;
  selectedRange?: AnalyticsRange;
  canMoveBack?: boolean;
  canMoveForward: boolean;
  today?: string;
  onMoveBack(): void;
  onMoveForward(): void;
  onSelectDay(day: string): void;
  onSelectRange(range: AnalyticsRange): void;
}

const ranges: AnalyticsRange[] = [7, 30, 90, "all"];

export function TimeNavigator({
  backgroundActivity,
  label,
  mode,
  selectedDay,
  selectedRange,
  canMoveBack = true,
  canMoveForward,
  today = todayDay(),
  onMoveBack,
  onMoveForward,
  onSelectDay,
  onSelectRange
}: TimeNavigatorProps): React.JSX.Element {
  const [isOpen, setOpen] = useState(false);
  const closeMenu = (): void => setOpen(false);
  const yesterday = shiftDay(today, -1);

  return (
    <div aria-label="Time period" className="atlas-toolbar-cluster" role="group">
      <Tooltip delay={400}>
        <Button className="atlas-toolbar-icon" isIconOnly aria-label={mode === "day" ? "Previous day" : "Previous period"} isDisabled={!canMoveBack} onPress={onMoveBack} variant="tertiary">
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Tooltip.Content>{mode === "day" ? "Previous day" : "Previous period"}</Tooltip.Content>
      </Tooltip>
      <Popover isOpen={isOpen} onOpenChange={setOpen}>
        <Button className="atlas-period-trigger justify-between" variant="secondary">
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-4 text-muted" />
        </Button>
        <Popover.Content className="atlas-time-popover" offset={7} placement="bottom start">
          <Popover.Dialog className="atlas-time-menu">
            <div className="atlas-time-menu-section">
              <Popover.Heading className="text-sm font-medium">Choose a day</Popover.Heading>
              <Button
                aria-pressed={mode === "day" && selectedDay === today}
                className="atlas-time-option"
                fullWidth
                onPress={() => { onSelectDay(today); closeMenu(); }}
                variant={mode === "day" && selectedDay === today ? "secondary" : "ghost"}
              >
                <DayIcon className="atlas-time-option__icon" />
                <span className="flex-1 text-start">Today</span>
                {mode === "day" && selectedDay === today ? <CheckIcon className="atlas-time-option__check" /> : null}
              </Button>
              <Button
                aria-pressed={mode === "day" && selectedDay === yesterday}
                className="atlas-time-option"
                fullWidth
                onPress={() => { onSelectDay(yesterday); closeMenu(); }}
                variant={mode === "day" && selectedDay === yesterday ? "secondary" : "ghost"}
              >
                <HistoryIcon className="atlas-time-option__icon" />
                <span className="flex-1 text-start">Yesterday</span>
                {mode === "day" && selectedDay === yesterday ? <CheckIcon className="atlas-time-option__check" /> : null}
              </Button>
              <div className="atlas-time-date-field">
                <Label htmlFor="usage-day">Date</Label>
                <input
                  className="atlas-time-date"
                  id="usage-day"
                  max={today}
                  defaultValue={mode === "day" ? selectedDay : today}
                  onChange={(event) => {
                    const { valid } = event.currentTarget.validity;
                    if (valid && event.currentTarget.value) onSelectDay(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.currentTarget.validity.valid && event.currentTarget.value) closeMenu();
                  }}
                  type="date"
                />
              </div>
            </div>
            <div className="atlas-time-menu-section">
              <p className="text-sm font-medium">Choose a range</p>
              {ranges.map((range) => (
                <Button
                  aria-pressed={mode === "range" && selectedRange === range}
                  className="atlas-time-option atlas-time-option--range"
                  fullWidth
                  key={range}
                  onPress={() => { onSelectRange(range); closeMenu(); }}
                  variant={mode === "range" && selectedRange === range ? "secondary" : "ghost"}
                >
                  {range === "all"
                    ? <TrendsIcon className="atlas-time-option__icon" />
                    : <CalendarRangeIcon className="atlas-time-option__icon" />}
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <span>{formatPeriodLabel(range)}</span>
                    <span className="text-xs font-normal text-muted">{range === "all" ? "Full collected history" : "View trends"}</span>
                  </span>
                  {mode === "range" && selectedRange === range ? <CheckIcon className="atlas-time-option__check" /> : null}
                </Button>
              ))}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Tooltip delay={400}>
        <Button className="atlas-toolbar-icon" isIconOnly aria-label={mode === "day" ? "Next day" : "Next period"} isDisabled={!canMoveForward} onPress={onMoveForward} variant="tertiary">
          <ChevronRightIcon className="size-4" />
        </Button>
        <Tooltip.Content>{mode === "day" ? "Next day" : "Next period"}</Tooltip.Content>
      </Tooltip>
      {backgroundActivity}
    </div>
  );
}

export function ProviderScopeSelect({
  providers,
  value,
  onChange
}: {
  providers: DashboardProvider[];
  value: ProviderScope;
  onChange(value: ProviderScope): void;
}): React.JSX.Element {
  const selectedProvider = providers.find((provider) => provider.id === value);

  return (
    <Select
      aria-label="Tool"
      className="atlas-provider-select"
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
      selectedKey={value}
      variant="secondary"
    >
      <Select.Trigger className="atlas-provider-select__trigger">
        <Select.Value className="atlas-provider-select__value">
          {selectedProvider
            ? <ProviderLogo mini providerID={selectedProvider.id} providerName={selectedProvider.name} />
            : (
              <span aria-hidden="true" className="atlas-provider-option__all-icon">
                <ProvidersIcon />
              </span>
            )}
          <span className="truncate">{selectedProvider?.name ?? "All tools"}</span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="atlas-provider-select__popover" placement="bottom end">
        <ListBox aria-label="Tools" className="atlas-provider-options">
          <ListBox.Item className="atlas-provider-option" id="all" textValue="All tools">
            <span aria-hidden="true" className="atlas-provider-option__all-icon">
              <ProvidersIcon />
            </span>
            <span className="atlas-provider-option__label">All tools</span>
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {providers.map((provider) => (
            <ListBox.Item className="atlas-provider-option" id={provider.id} key={provider.id} textValue={provider.name}>
              <ProviderLogo mini providerID={provider.id} providerName={provider.name} />
              <span className="atlas-provider-option__label">{provider.name}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
