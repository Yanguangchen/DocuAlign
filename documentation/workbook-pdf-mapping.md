# Workbook-to-PDF Mapping

## 1. Authoritative reference

The mapping is verified against:

- `SampleDocuments/SampleInput.xlsx`
- `SampleDocuments/SampleOutput.pdf`
- `rak_pdf_excel_field_mapping.json`

`SampleOutput.pdf` is the five-page report for workbook group **2**:

| Role | Reference tab | Report value |
| --- | --- | --- |
| Cover | `CV1 (2)` | Job `X-2026-522-2`, sample `3-A` |
| Consolidated pages 2–5 | `TR1 (2)` | Formula-linked to `DS1  (2)` and `SB1  (2)` |
| Upstream test calculations | `DS1  (2)` | PSD, moisture, density, coral/shell, organic |
| Upstream direct shear | `SB1  (2)` | Shear stress and displacement |

The previous JSON mixed `CV1 (2)` with `TR1 (4)`. That was incorrect:
the body values in the reference PDF (for example PSD `95, 84, 57, 35,
26, 7, 1`, moisture `9.7`, and shear angle `38`) all come from
`TR1 (2)`. References to non-existent `OM1` and `MET1` tabs were also
incorrect; organic and metallic results are consolidated on each `TR1` tab.

## 2. Repeated report groups

`src/report-mapping.js` discovers the repeated groups by tab role and numeric
suffix. It normalizes the workbook's inconsistent spaces in `DS1`/`SB1`
names, but retains the exact names when reading cells.

| Group | Cover | Report | Data | Shear | Summary row | Job suffix |
| ---: | --- | --- | --- | --- | ---: | ---: |
| 1 | `CV1` | `TR1` | `DS1 ` | `SB1 ` | 18 | `-1` |
| 2 | `CV1 (2)` | `TR1 (2)` | `DS1  (2)` | `SB1  (2)` | 19 | `-2` |
| 3 | `CV1 (3)` | `TR1 (3)` | `DS1  (3)` | `SB1  (3)` | 20 | `-3` |
| 4 | `CV1 (4)` | `TR1 (4)` | `DS1  (4)` | `SB1  (4)` | 21 | `-4` |
| 5 | `CV1 (5)` | `TR1 (5)` | `DS1  (5)` | `SB1  (5)` | 22 | `-5` |
| 6 | `CV1 (6)` | `TR1 (6)` | `DS1  (6)` | `SB1  (6)` | 23 | `-6` |

One coordinate mapping is reused for every group. The checked-in JSON records
group 2 as the golden reference; runtime mapping substitutes each discovered
group's `CV1` and `TR1` tab.

## 3. Page 1 — cover

All dynamic cover values come from the group's `CV1` tab.

| PDF field | Logical key | Excel source | Transform |
| --- | --- | --- | --- |
| Client Name | `client_name` | `K5` | Trim text |
| Address line 1 | `client_address_line_1` | `K6` | Trim text |
| Address line 2 | `client_address_line_2` | `K7` | Trim text |
| Tel No/Fax No | `tel_fax_no` | `K8` | Trim text |
| Email | `client_email` | `K9` | Trim text |
| Attention to | `attention_to` | `K10` | Trim text |
| Project Code/Title | `project_code_title` | `K12` | Trim text |
| Test Method list | `test_method_list` | `K14:L19` | Join K numbering with L text |
| Test Standards list | `test_standards_list` | `K21:L26` | Join K numbering with L text |
| Job Ref. | `job_ref` | `K28` | Cached formula display value |
| Vessel Name | `vessel_name` | `K29` | Cached formula display value |
| VOY No. | `voy_no` | `K30` | Trim trailing space |
| Client Ref./Sample ID | `client_ref_sample_id` | `K31` | Cached formula display value |
| Sampling Date | `sampling_date` | `K32` | Excel display format `dd/mm/yyyy` |
| Date Received | `date_received` | `K33` | Excel display format `dd/mm/yyyy` |
| Date of Report | `date_of_report` | `K34` | Excel display format `dd/mm/yyyy` |
| Total Pages | `total_pages` | `K36` | Trim text |
| Remarks | `cover_remarks` | `K37` | Trim text |

The RAK company block, `TEST REPORT` title, field labels, and Terms &
Conditions are fixed template content taken from the sample PDF.

## 4. Page 2 — PSD, silt/coral, and moisture

All primary sources are relative to the group's `TR1` tab. The `TR1` formulas
already contain cached values from the corresponding `DS1` tab.

| PDF field | Logical key | TR source | Transform |
| --- | --- | --- | --- |
| Job header | `page_2_job_ref` | `AE2` | Trim text |
| Sieve sizes | `psd_sieve_size_mm` | `A8:A14` | Preserve Excel display precision |
| Cumulative passing | `psd_cumulative_percent_passing` | `I8:I14` | Ordered seven-row vector |
| JTC lower limits | `psd_lower_limit_jtc` | `Q8:Q14` | Ordered seven-row vector |
| JTC upper limits | `psd_upper_limit_jtc` | `Z8:Z14` | Ordered seven-row vector |
| PSD remark 1 | `psd_remarks_1` | `E24` | Trim text, retain `1)` |
| PSD remark 2 | `psd_remarks_2` | `E25` | Trim text, retain `2)` |
| Silt content | `silt_content_percent` | `R28` | One-decimal display value |
| Coral/shell content | `coral_shell_content_percent` | `R29` | One-decimal display value |
| Total | `silt_coral_shell_total_percent` | `R30` | One-decimal display value |
| JTC requirement | `silt_coral_shell_jtc_requirement` | `AA30` | Trim text |
| Moisture content | `moisture_content_percent` | `R33` | One-decimal display value |
| Moisture remark | `moisture_remarks` | `E34` | Trim leading space |

The grading chart is regenerated from the seven PSD rows. Sieve size uses a
logarithmic X axis; cumulative passing, lower limit, and upper limit are drawn
as separate series.

## 5. Page 3 — direct shear and organic matter

| PDF field | Logical key | TR source | Transform |
| --- | --- | --- | --- |
| Job header | `page_3_job_ref` | `AE42` | Trim text |
| Maximum dry density | `maximum_dry_density_mg_m3` | `U46` | Two-decimal display value |
| Minimum dry density | `minimum_dry_density_mg_m3` | `U47` | Two-decimal display value |
| Retained on 2 mm | `retained_on_2mm_percent` | `U48` | Whole-number display value |
| Shearing rate | `shearing_rate_mm_min` | `U49` | One-decimal display value |
| Relative density condition | `relative_density_condition` | `A50` | Trim text |
| Initial bulk density | `initial_bulk_density_mg_m3` | `U50` | Two-decimal display value |
| Initial dry density | `initial_dry_density_mg_m3` | `U51` | Two-decimal display value |
| Shearing resistance angle | `angle_of_shearing_resistance_deg` | `A53` | Whole-number display value |
| JTC angle requirement | `angle_jtc_requirement` | `P53` | Trim text |
| Normal stress | `normal_stress_kpa` | `M55,P55,V55,AB55` | Left-to-right vector |
| Maximum shear stress | `max_shear_stress_kpa` | `M56,P56,V56,AB56` | Left-to-right vector |
| Horizontal displacement | `horizontal_displacement_mm` | `M57,P57,V57,AB57` | Preserve mixed decimals |
| Organic matter | `organic_matter_content_percent` | `R71` | Two-decimal display value |

Two charts are regenerated inside the original sample-PDF chart frames:
normal stress versus maximum shear stress uses the four TR summary points;
horizontal displacement versus maximum shear stress uses all cached points
from `SB1` columns `E:F`, `K:L`, and `Q:R`.

## 6. Page 4 — metallic analysis and sign-off

| PDF field | Logical key | TR source | Transform |
| --- | --- | --- | --- |
| Job header | `page_4_job_ref` | `AE89` | Trim text |
| Element names | `metal_element_names` | `A95:A106` | Ordered 12-row vector, retain symbols |
| Results | `metal_results_ppm` | `L95:L106` | Cached formula display (`N/A`, `<1`, or value) |
| Upper limits | `metal_upper_limit_concentration_ppm` | `X95:X106` | Ordered 12-row vector |
| ICP flags | `metal_icp_values_flag` | `AK95:AK106` | Upstream helper; not printed |
| Less-than remark | `metal_remarks_less_than` | `E108` | Trim text |
| Digestion remark | `metal_remarks_digestion` | `E109` | Trim text |
| Units remark | `metal_remarks_units` | `E110` | Trim text |
| Prepared signature | `prepared_by_signature_image` | Drawing near row 130, column C | Extract PNG relationship |
| Authorised signature | `authorised_by_signature_image` | Drawing near row 130, column X | Extract JPEG relationship |

The sign-off names and titles are fixed text-box content in the source report:
Jocelyn Lee Jia Min / Lab Engineer and Ken Lee / Managing Director.

The cover lists EPA 6010D while the page-4 sample title says EPA 6010C. The
renderer preserves both source artifacts exactly: the cover standard comes
from `CV1`, and the page-4 section title follows the sample PDF.

## 7. Page 5 — appendix

| PDF field | Logical key | TR source | Transform |
| --- | --- | --- | --- |
| Job header | `page_5_job_ref` | `AE139` | Trim text |
| Appendix title | `appendix_title` | `A144` | Trim text |
| Photo label | `sample_photos_label` | `A146` | Trim text |
| Photo 1 | `sample_photo_1` | Image-filled shape anchored near row 148 | Resolve drawing relationship |
| Photo 2 | `sample_photo_2` | Image-filled shape anchored near row 170 | Resolve drawing relationship |

`src/workbook-pdf.js` reads XLSX relationship XML and associates embedded media
bytes with sheet name and anchor row/column. `src/report-mapping.js` selects the
two appendix JPEGs and two sign-off images for each report group.

## 8. Export behavior and validation

The workbook contains six complete report groups. Export produces one PDF with
six consecutive five-page reports (**30 pages**), rather than dumping 26 raw
worksheet grids. Each report starts as a copy of the five approved
`SampleOutput.pdf` pages. If its complete data/image fingerprint matches the
reference sample, no overlays are added and the rendered pixels are identical.
Other groups overlay changed values and images at measured reference
coordinates. `Summary` and `coral + org` remain upstream calculation tabs;
their values reach the PDF through cached formulas on `CV1` and `TR1`.

Automated golden checks verify:

- all six report groups and job references;
- the exact sample-2 cover, PSD, silt/coral, moisture, shear, organic, and
  metallic values visible in `SampleOutput.pdf`;
- two signatures and two appendix photos;
- five pages for one report and 30 pages for the complete workbook;
- the mapping JSON contains no group-4 or non-existent OM/MET source references.

The browser reads cached formula results stored in the workbook. It does not
recalculate Excel formulas; workbooks must be saved by Excel (or another
calculation-capable editor) after source values change.
