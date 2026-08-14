// Styling matches Suhaas's original app exactly (reference:
// pps-psychology-tauri-app/src/components/MatrixQuestion.tsx) — large text-2xl
// rows with p-3 cells so only a few questions fit per screen and the page
// scrolls, exactly like the pilot-study build.
interface MatrixQuestionProps {
  rows: string[];
  columns: string[];
  onSelectionChange: (rowIndex: number, columnIndex: number) => void;
  selections?: { [key: string]: number };
  title?: string;
  className?: string;
}

function MatrixQuestion({
  rows,
  columns,
  onSelectionChange,
  selections = {},
  title,
  className = "",
}: MatrixQuestionProps) {
  const handleCellClick = (rowIndex: number, columnIndex: number) => {
    onSelectionChange(rowIndex, columnIndex);
  };

  return (
    <div className={`bg-black border p-6 ${className}`}>
      {title && (
        <h2 className="text-white text-2xl font-bold mb-6 text-center">
          {title}
        </h2>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-white text-left p-3 border-b border-white"></th>
              {columns.map((column, index) => (
                <th
                  key={index}
                  className="text-white text-center p-3 border-b border-white min-w-[120px]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-gray-600">
                <td className="text-white p-3 text-2xl align-top">{row}</td>
                {columns.map((_, columnIndex) => (
                  <td key={columnIndex} className="text-center p-3 align-top">
                    <button
                      onClick={() => handleCellClick(rowIndex, columnIndex)}
                      className={`w-6 h-6 rounded-full border-2 transition-colors ${
                        selections[rowIndex] === columnIndex
                          ? "bg-white border-white"
                          : "border-white hover:bg-gray-700"
                      }`}
                      aria-label={`Select column ${
                        columnIndex + 1
                      } for ${row}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MatrixQuestion;
