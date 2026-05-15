import * as React from 'react';
import * as Icons from 'lucide-react';

export type LucideIconName = keyof typeof Icons;

export function LucideIcon({ name, size = 18, color = 'currentColor', ...props }: { name: LucideIconName; size?: number; color?: string } & React.SVGProps<SVGSVGElement>) {
  const Icon = Icons[name] as any;
  if (!Icon) return null;
  return <Icon size={size} color={color} {...props} />;
}
