import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Aurora } from '@/components/aurora';
import { BrandMark } from '@/components/logo';

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Aurora />
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/">
          <BrandMark />
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 text-center">
        <div className="glass grid size-16 place-items-center rounded-2xl">
          <Compass className="size-7 text-violet-300" />
        </div>
        <div className="space-y-2">
          <h1 className="text-gradient text-4xl font-semibold tracking-tight">404</h1>
          <p className="text-[13.5px] text-slate-400">这个页面好像走丢了，也许它还没被登记。</p>
        </div>
        <Button asChild>
          <Link to="/">
            <Home className="size-4" /> 回到圈名广场
          </Link>
        </Button>
      </div>
    </div>
  );
}
