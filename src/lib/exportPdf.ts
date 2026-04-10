import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function captureAndExportPDF(element: HTMLElement, filename: string) {
  const pages = element.querySelectorAll<HTMLElement>('[data-page]')
  if (pages.length === 0) return

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()   // 297mm
  const pageH = doc.internal.pageSize.getHeight()  // 210mm

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#f1f5f9',
      width: pages[i].offsetWidth,
      height: pages[i].offsetHeight,
    })

    if (i > 0) doc.addPage()
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH)
  }

  doc.save(filename)
}
