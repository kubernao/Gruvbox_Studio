import React from 'react';
import FileExplorer from '../../features/explorer/components/FileExplorer';
import './Sidebar.css';

const Sidebar: React.FC = () => {
  return (
    <div className="sidebar">
      <FileExplorer />
    </div>
  );
};

export default Sidebar;
