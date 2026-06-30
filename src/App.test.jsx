import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App.jsx';

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the initial layout with brand, titles, and dropzone prompt', () => {
    render(<App />);
    expect(screen.getByText('DocuAlign')).toBeInTheDocument();
    expect(screen.getByText('Drop your Excel workbook here')).toBeInTheDocument();
    expect(screen.getByText(/No data leaves your device until you choose to save it\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save data to cloud/i })).toBeDisabled();
  });

  it('handles selecting a valid .xlsx file via input element (formatFileSize KB)', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['dummy content'], 'report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(file, 'size', { value: 2048 }); // 2.0 KB

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('report.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB / Ready to import')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save data to cloud/i })).toBeEnabled();
  });

  it('handles selecting a valid .xls file in bytes (formatFileSize B)', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['data'], 'legacy.xls', { type: 'application/vnd.ms-excel' });
    Object.defineProperty(file, 'size', { value: 512 }); // 512 B

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('legacy.xls')).toBeInTheDocument();
    expect(screen.getByText('512 B / Ready to import')).toBeInTheDocument();
  });

  it('handles selecting a large valid .xlsx file in megabytes (formatFileSize MB)', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['data'], 'huge_report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 }); // 5.0 MB

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('huge_report.xlsx')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB / Ready to import')).toBeInTheDocument();
  });

  it('handles selecting an invalid file extension', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['data'], 'document.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('Choose an Excel workbook in .xlsx or .xls format.')).toBeInTheDocument();
    expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save data to cloud/i })).toBeDisabled();
  });

  it('ignores empty selection (canceling file picker)', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);

    fireEvent.change(input, { target: { files: [] } });

    expect(screen.getByText('Drop your Excel workbook here')).toBeInTheDocument();
  });

  it('handles drag enter, drag over, drag leave, and drop of a valid file', () => {
    const { container } = render(<App />);
    const dropzone = container.querySelector('.dropzone');

    // Drag enter
    fireEvent.dragEnter(dropzone);
    expect(screen.getByText('Release to add workbook')).toBeInTheDocument();

    // Drag over
    fireEvent.dragOver(dropzone);

    // Drag leave inside dropzone child element should not disable dragging state
    const leaveChildEvent = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leaveChildEvent, 'relatedTarget', { value: dropzone });
    fireEvent(dropzone, leaveChildEvent);
    expect(screen.getByText('Release to add workbook')).toBeInTheDocument();

    // Drag leave outside dropzone should disable dragging state
    const leaveOutsideEvent = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leaveOutsideEvent, 'relatedTarget', { value: null });
    fireEvent(dropzone, leaveOutsideEvent);
    expect(screen.getByText('Drop your Excel workbook here')).toBeInTheDocument();

    // Drag enter and drop
    fireEvent.dragEnter(dropzone);
    const file = new File(['data'], 'dragged.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(file, 'size', { value: 1024 }); // 1.0 KB
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(screen.getByText('dragged.xlsx')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB / Ready to import')).toBeInTheDocument();
  });

  it('handles replacing and removing a selected file', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['data'], 'initial.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(file, 'size', { value: 100 });

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('initial.xlsx')).toBeInTheDocument();

    // Test Replace button click
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const replaceBtn = screen.getByRole('button', { name: /Replace/i });
    fireEvent.click(replaceBtn);
    expect(clickSpy).toHaveBeenCalled();

    // Test Remove button click
    const removeBtn = screen.getByRole('button', { name: /Remove/i });
    fireEvent.click(removeBtn);
    expect(screen.queryByText('initial.xlsx')).not.toBeInTheDocument();
    expect(screen.getByText('Drop your Excel workbook here')).toBeInTheDocument();
  });

  it('handles clicking save data to cloud button', () => {
    render(<App />);
    const input = screen.getByLabelText(/Drop your Excel workbook here/i);
    const file = new File(['data'], 'report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    fireEvent.change(input, { target: { files: [file] } });

    const saveBtn = screen.getByRole('button', { name: /Save data to cloud/i });
    fireEvent.click(saveBtn);

    expect(screen.getByText('Cloud saving will be connected in the next step.')).toBeInTheDocument();
  });
});
