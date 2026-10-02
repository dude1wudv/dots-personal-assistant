import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'

const root = document.getElementById('root')
if (!root) throw new Error('应用挂载节点不存在')
ReactDOM.createRoot(root).render(<React.StrictMode><App/></React.StrictMode>)
