// Test-only DOM adapters. These do not model WeChat native control behavior.
import { useLayoutEffect, useRef, type AriaRole, type ReactNode } from 'react';
type Props = { children?: ReactNode; className?: string; id?: string; ariaLabel?: string; ariaHidden?: boolean;
  role?: AriaRole; disabled?: boolean; onClick?: () => void; selectable?: boolean };
export function View({ children, className, id, role }: Props) { return <div className={className} id={id} role={role}>{children}</div>; }
export function Text({ children, className, ariaHidden }: Props) { return <span className={className} aria-hidden={ariaHidden}>{children}</span>; }
export function Button({ children, className, id, ariaLabel, disabled, onClick }: Props) {
  return <button type='button' className={className} id={id} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>{children}</button>;
}
export function Input(props: Props & { value?: string; placeholder?: string; maxlength?: number; confirmType?: string;
  onInput?: (event: { detail: { value: string } }) => void; onConfirm?: (event: { detail: { value: string } }) => void }) {
  return <input className={props.className} id={props.id} aria-label={props.ariaLabel} value={props.value} placeholder={props.placeholder}
    maxLength={props.maxlength} onChange={event => props.onInput?.({ detail: { value: event.currentTarget.value } })}
    onKeyDown={event => { if (event.key === 'Enter') props.onConfirm?.({ detail: { value: event.currentTarget.value } }); }} />;
}
export function Switch(props: Props & { checked?: boolean; color?: string; onChange?: (event: { detail: { value: boolean } }) => void }) {
  return <input type='checkbox' id={props.id} aria-label={props.ariaLabel} checked={props.checked} disabled={props.disabled}
    onChange={event => props.onChange?.({ detail: { value: event.currentTarget.checked } })} />;
}
export function Textarea(props: Props & { value?: string; placeholder?: string; maxlength?: number; autoHeight?: boolean;
  onInput?: (event: { detail: { value: string } }) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (props.autoHeight && ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${ref.current.scrollHeight}px`; }
  }, [props.value, props.autoHeight]);
  return <textarea ref={ref} className={props.className} id={props.id} aria-label={props.ariaLabel} value={props.value}
    placeholder={props.placeholder} maxLength={props.maxlength} onChange={event => props.onInput?.({ detail: { value: event.currentTarget.value } })} />;
}
export function Checkbox(props: Props & { value: string; checked?: boolean; color?: string }) {
  return <input type='checkbox' value={props.value} checked={props.checked} readOnly />;
}
export function CheckboxGroup(props: Props & { onChange?: (event: { detail: { value: string[] } }) => void }) {
  return <div onChange={event => props.onChange?.({ detail: { value: Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.value) } })}>{props.children}</div>;
}
export function Label({ children, className }: Props) { return <label className={className}>{children}</label>; }
export function Image(props: Props & { src: string; mode?: string; lazyLoad?: boolean; onLoad?: () => void; onError?: () => void }) {
  return <img className={props.className} src={props.src} alt={props.ariaLabel ?? ''} aria-hidden={props.ariaHidden}
    style={{ objectFit: props.mode === 'aspectFill' ? 'cover' : 'contain' }} onLoad={props.onLoad} onError={props.onError} />;
}
