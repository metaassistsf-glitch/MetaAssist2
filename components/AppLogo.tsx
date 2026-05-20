import React, { useState } from 'react';

interface AppLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const AppLogo: React.FC<AppLogoProps> = ({ className = '', size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-lg',
    md: 'w-10 h-10 text-xl',
    lg: 'w-16 h-16 text-3xl',
    xl: 'w-24 h-24 text-5xl',
  };

  return (
    <div className={`relative flex items-center justify-center bg-gradient-to-br from-[#FFE600] to-[#E5CF00] rounded-2xl shadow-lg shadow-[#FFE600]/30 text-[#2E2E38] overflow-hidden shrink-0 ${sizeClasses[size]} ${className}`}>
      {/* Abstract logo shapes */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48cGF0aCBkPSJNMjAgMEwyMCA0ME0wIDIwTDQwIDIwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+')] opacity-50 mix-blend-overlay"></div>
      <i className="fas fa-cubes relative z-10 drop-shadow-md"></i>
      
      {/* Decorative glow */}
      <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-white/20 blur-md rounded-full transform translate-x-1/4 -translate-y-1/4"></div>
    </div>
  );
};

export default AppLogo;
