      const row=document.getElementById('nx-preset-chips') || document.querySelector('.preset-chip-row');
      if(!row)return;
      let drag=null,original=[],dropped=false,suppress=false;
      const ids=()=>[...row.querySelectorAll('[data-preset-select]')].map(n=>n.getAttribute('data-preset-select'));
      const restore=()=>original.forEach(id=>{const node=[...row.children].find(n=>n.getAttribute('data-preset-select')===id);if(node)row.append(node);});
      for(const tile of row.querySelectorAll('[data-preset-select]')) {
        tile.addEventListener('click',async ev=>{ev.preventDefault();ev.stopPropagation();if(suppress){suppress=false;return;}await e(tile.getAttribute('data-preset-select'));});
        tile.addEventListener('dragstart',ev=>{drag=tile;original=ids();dropped=false;suppress=true;tile.classList.add('dragging');ev.dataTransfer?.setData('text/plain',tile.getAttribute('data-preset-select'));});
        tile.addEventListener('dragover',ev=>{
          if(!drag || drag===tile)return;ev.preventDefault();
          const nodes=[...row.children];row.insertBefore(drag,nodes.indexOf(drag)<nodes.indexOf(tile)?tile.nextSibling:tile);
        });
        tile.addEventListener('drop',ev=>{
          ev.preventDefault();ev.stopPropagation();if(!drag)return;dropped=true;
          const card=kt(t.backendSettings?.card||{}),order=ids();
          card.presets=order.map(id=>card.presets.find(p=>presetIdEq(p.id,id))).filter(Boolean);
          t.backendSettings.card=card;
          const select=document.getElementById('nx-preset-select');
          if(select){const selected=select.value;order.forEach(id=>{const option=[...select.options].find(o=>presetIdEq(o.value,id));if(option)select.append(option);});select.value=selected;}
          queueSettingsSave({card:{presets:card.presets}});
        });
        tile.addEventListener('dragend',()=>{if(!dropped)restore();drag?.classList.remove('dragging');drag=null;setTimeout(()=>{suppress=false;},0);});
      }
