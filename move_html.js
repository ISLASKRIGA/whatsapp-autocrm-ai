const fs = require('fs');

const htmlPath = 'public/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// The block we want to extract
const startMarker = '<!-- ═══ CAMPAÑAS DE ATRIBUCIÓN ═══ -->';
const endMarker = '<!-- Campaign Create/Edit Modal -->'; // We should probably move the modal too.

// Actually, the modal ends with:
//                             <button onclick="saveCampaign()"
//                                 style="background:linear-gradient(135deg,#6366f1,#8b5cf6); border:none; color:white; padding:12px 24px; border-radius:10px; font-weight:600; font-size:0.95rem; cursor:pointer;">Guardar</button>
//                         </div>
//                     </div>
//                 </div>
//             </section>

// Let's just find the start and end indices of the block to move.
const sectionStartIndex = html.indexOf(startMarker);
if (sectionStartIndex === -1) {
    console.log("Start marker not found");
    process.exit(1);
}

// Find the end of the modal container
const modalStartIndex = html.indexOf(endMarker, sectionStartIndex);
const btnIndex = html.indexOf('onclick="saveCampaign()"', modalStartIndex);
const div1 = html.indexOf('</div>', btnIndex);
const div2 = html.indexOf('</div>', div1 + 6);
const div3 = html.indexOf('</div>', div2 + 6);
const sectionEndIndex = div3 + 6; // Include the closing tag

const blockToMove = html.substring(sectionStartIndex, sectionEndIndex);
console.log("Block to move length:", blockToMove.length);

if (blockToMove.length < 1000) {
    console.log("Block seems too small:", blockToMove);
    process.exit(1);
}

// Remove from original
html = html.substring(0, sectionStartIndex) + html.substring(sectionEndIndex);

// Target where to insert
const targetStartMarker = '<div class="reportes-empty-state"';
const targetStartIndex = html.indexOf(targetStartMarker);

if (targetStartIndex === -1) {
    console.log("Target start marker not found");
    process.exit(1);
}

// target empty state ends with `</section>` of reportes
const reportesEnd = html.indexOf('</section>', targetStartIndex);
// we want to place it just before `</div>\n                </div>\n            </section>`
const targetInjectIndex = html.lastIndexOf('</div>', html.lastIndexOf('</div>', reportesEnd - 1) - 1);

// Actually just replace reportes-empty-state completely.
const emptyStateEnd = html.indexOf('</div>', html.indexOf('</div>', html.indexOf('</div>', targetStartIndex) + 6) + 6) + 6;
const emptyStateBlock = html.substring(targetStartIndex, emptyStateEnd);

if (!emptyStateBlock.includes('Sin datos de')) {
    console.log("Unexpected empty state block");
    process.exit(1);
}

html = html.substring(0, targetStartIndex) + blockToMove + html.substring(emptyStateEnd);

fs.writeFileSync(htmlPath, html);
console.log("SUCCESS: Moved campaign attribution HTML section");
