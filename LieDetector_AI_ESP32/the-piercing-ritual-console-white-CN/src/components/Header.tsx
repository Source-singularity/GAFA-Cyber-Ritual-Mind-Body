import React from 'react';
import { Terminal } from 'lucide-react';

export default function Header({ isAborted }: { isAborted: boolean }) {
  return (
    // 1. 修改边框颜色为 border-gray-300，背景改为 bg-white
    <header className="border-b-2 border-gray-300 pb-4 flex items-center justify-between z-10 bg-white relative">
     {/* ★ 插入这一行：点阵将覆盖在这个面板的所有文字和背景之上 */}
      <div className="panel-dot-overlay"></div>
      <div className="flex items-center gap-4">
        {/* 2. 修改图标颜色为 text-gray-400 (对应原来的半透明白) */}
        <Terminal className="w-8 h-8 text-gray-400" />
        
        {/* 3. 修改标题颜色为 text-black，副标题改为 text-gray-400 */}
        <h1 className="text-2xl md:text-4xl mr-200 font-heiti-bold tracking-tighter uppercase glitch text-black" data-text="RITUAL CONSOLE: Subjectivity Verification">
         仪式控制台： <span className="text-gray-400">异质植入接受度测算</span>
        </h1>
      </div>
      
      {/* 4. 修改右侧状态栏的边框和背景 */}
      <div className="flex items-center gap-3 border border-gray-300 px-4 py-2 bg-gray-50">
        <div className={`w-3 h-3 rounded-full ${isAborted ? 'bg-gray-400' : 'bg-red-600 animate-pulse'}`}></div>
        
        {/* 5. 修改状态文字颜色为 text-gray-600 */}
        <span className="text-xs font-bold tracking-widest uppercase text-gray-600">
          {isAborted ? 'SYSTEM OFFLINE' : 'REC_ACTIVE'}
        </span>
      </div>
    </header>
  );
}
