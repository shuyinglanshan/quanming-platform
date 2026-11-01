import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'liquid liquid-sheen z-50 min-w-[11rem] overflow-hidden rounded-2xl p-1.5 text-slate-200',
          'bg-[linear-gradient(160deg,rgba(24,24,38,.94),rgba(10,10,18,.97))]',
          'shadow-[0_30px_70px_-30px_rgba(0,0,0,.98),inset_0_1px_0_rgba(255,255,255,.1)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=open]:slide-in-from-top-1',
          'data-[state=open]:duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'danger' }) {
  return (
    <DropdownMenuPrimitive.Item
      data-variant={variant}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] outline-none select-none',
        'transition-[background-color,color,transform] duration-150',
        'focus:bg-white/10 focus:text-white active:scale-[0.985]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-400',
        variant === 'danger' && 'text-rose-300 focus:bg-rose-500/15 focus:text-rose-200 [&_svg]:text-rose-300',
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2.5 py-1.5 text-[11px] tracking-wide text-slate-500', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-white/10', className)} {...props} />;
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-xl py-2 pr-2 pl-8 text-[13px] outline-none transition-colors focus:bg-white/10',
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5 text-violet-300" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
  DropdownMenuCheckboxItem,
  ChevronRightIcon,
};
