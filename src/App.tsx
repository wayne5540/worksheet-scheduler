import './styles.css'

const navItems = ['員工管理', '規則設定', '月度排班'] as const

function App() {
  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Work Schedule</p>
          <h1>門市排班系統</h1>
        </div>

        <nav aria-label="主要頁面" className="tabs" role="tablist">
          {navItems.map((item) => (
            <button
              aria-selected={item === '月度排班'}
              className="tab"
              key={item}
              role="tab"
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </header>

      <section aria-labelledby="monthly-schedule-title" className="workspace">
        <div className="workspaceHeader">
          <div>
            <p className="eyebrow">Monthly Schedule</p>
            <h2 id="monthly-schedule-title">月度排班</h2>
          </div>

          <div className="controls">
            <label>
              月份
              <input defaultValue="2026-06" type="month" />
            </label>
            <button disabled type="button">
              產生班表
            </button>
          </div>
        </div>

        <div className="scheduleFrame">
          <table>
            <caption>班表草稿</caption>
            <thead>
              <tr>
                <th scope="col">員工</th>
                <th scope="col">前一個月</th>
                <th scope="col">1 一</th>
                <th scope="col">2 二</th>
                <th scope="col">3 三</th>
                <th scope="col">4 四</th>
                <th scope="col">5 五</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">尚未新增</th>
                <td aria-label="前一個月班別">-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
