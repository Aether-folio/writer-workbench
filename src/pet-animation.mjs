import dragonWriting from '../assets/pets/dragon-writing.gif';
import dragonResting from '../assets/pets/dragon-resting.gif';
import fishWriting from '../assets/pets/fish-writing.gif';
import fishResting from '../assets/pets/fish-resting.gif';

const pets={
  dragon:{name:'龙娘',writing:dragonWriting,resting:dragonResting},
  fish:{name:'大肥鱼',writing:fishWriting,resting:fishResting},
};

export function attachPetAnimation() {
  const stage=document.getElementById('stats-pet-stage'),image=document.getElementById('stats-pet-image');
  let pet={enabled:false,character:'dragon'},state='resting',available=false;
  function render() {
    stage.hidden=!available || !pet.enabled;
    if(stage.hidden){image.removeAttribute('src');return;}
    const character=pets[pet.character] || pets.dragon,source=character[state];
    // Do not restart the GIF on the statistics refresh tick.
    if(image.getAttribute('src')!==source)image.src=source;
    const description=character.name+' · '+(state==='writing'?'码字中':'休息中');
    image.alt=description;stage.dataset.state=state;stage.dataset.character=pet.character;
    document.dispatchEvent(new CustomEvent('workbench:stats-layout'));
  }
  document.addEventListener('workbench:writing-state',event=>{
    state=event.detail==='writing'?'writing':'resting';render();
  });
  return {setPreferences(preferences,supported){pet=preferences;available=supported;render();}};
}
